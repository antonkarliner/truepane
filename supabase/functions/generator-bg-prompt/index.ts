// Edge function for the App Store Strip Generator: turns a short text prompt
// into validated background-style parameters via Groq, returning ONLY a
// schema-checked, clamped object (raw model output never reaches the client
// renderer). Self-contained on purpose — no shared imports — so it can live in
// any Supabase project without coupling to that project's other env vars.
//
// Secrets: GROQ_API_KEY (already set in this project). Optional override:
// BG_PROMPT_MODEL. Deployed with verify_jwt=false (public, anonymous tool).

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const MODEL = Deno.env.get("BG_PROMPT_MODEL") || "llama-3.3-70b-versatile";
const CEREBRAS_MODEL = "gpt-oss-120b";
const SERVER_GROQ_KEY = Deno.env.get("GROQ_API_KEY") || "";
const SERVER_CEREBRAS_KEY = Deno.env.get("CEREBRAS_API_KEY") || "";

const FILLS = ["solid", "linear", "radial"];
const SHAPES = [
  "none",
  "rings",
  "blobs",
  "waves",
  "dots",
  "mesh",
  "arcs",
  "triangles",
  "grid",
  "zigzag",
  "bubbles",
];
const RING_LAYOUTS = ["calm", "anchor-low", "drift", "bookends", "center-stage", "constellation", "march"];
const HEX = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function toHex2(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
}
function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
// Legible text derived from the fill, so every scheme stays readable. For a
// gradient we average the two stops' luminance.
function deriveText(fill: string, color: string, gradientColor: string): {
  titleColor: string;
  subheadColor: string;
} {
  const lum = fill === "solid" ? luminance(color) : (luminance(color) + luminance(gradientColor)) / 2;
  return lum < 0.5
    ? { titleColor: "#ffffff", subheadColor: "rgba(255,255,255,0.72)" }
    : { titleColor: "#1a1612", subheadColor: "rgba(26,22,18,0.62)" };
}
// Push one color away from another in lightness if they're too close.
function pushAway(hex: string, fromHex: string, minDelta: number): string {
  const lf = luminance(fromHex);
  if (Math.abs(luminance(hex) - lf) >= minDelta) return hex;
  const [r, g, b] = hexToRgb(hex);
  const target = lf > 0.5 ? 0 : 255;
  const t = 0.5;
  return rgbToHex(r * (1 - t) + target * t, g * (1 - t) + target * t, b * (1 - t) + target * t);
}

function corsHeaders(origin?: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Best-effort in-memory rate limit (per isolate; resets on cold start).
const HITS = new Map<string, { count: number; reset: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = HITS.get(ip);
  if (!e || now > e.reset) {
    HITS.set(ip, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  e.count++;
  return e.count > MAX_PER_WINDOW;
}

function clampNum(n: unknown, lo: number, hi: number, dflt: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
}
function clampInt(n: unknown, lo: number, hi: number, dflt: number): number {
  return Math.round(clampNum(n, lo, hi, dflt));
}

// deno-lint-ignore no-explicit-any
function validate(raw: any) {
  const fill = FILLS.includes(raw?.fill) ? raw.fill : "solid";
  const shape = SHAPES.includes(raw?.shape) ? raw.shape : "none";
  const color = HEX.test(raw?.color) ? raw.color : "#f2eee6";
  let gradientColor = HEX.test(raw?.gradientColor) ? raw.gradientColor : "#c9d6e8";
  let accent = HEX.test(raw?.accent) ? raw.accent : "#c47c3b";
  // Shape color must contrast the fill base; gradient end must differ from start.
  if (shape !== "none") accent = pushAway(accent, color, 0.2);
  if (fill !== "solid") gradientColor = pushAway(gradientColor, color, 0.12);
  return {
    fill,
    shape,
    color,
    gradientColor,
    accent,
    accentOpacity: clampNum(raw?.accentOpacity, 0, 1, 0.55),
    density: clampInt(raw?.density, 1, 8, 3),
    ringLayout: RING_LAYOUTS.includes(raw?.ringLayout) ? raw.ringLayout : "calm",
    ringCount: clampInt(raw?.ringCount, 1, 8, 4),
    gradientAngle: clampInt(raw?.gradientAngle, 0, 360, 135),
    seed: Number.isFinite(Number(raw?.seed)) ? Math.floor(Number(raw.seed)) : Math.floor(Math.random() * 1e9),
  };
}

const SYSTEM = `You translate a short mood/description into background style parameters for an App Store screenshot generator. The background is a FILL layer plus an optional SHAPE overlay drawn on top; it sits behind a phone mockup and below the app's title text, so keep it tasteful and never let it overpower the screenshot. Respond ONLY with a JSON object (no prose) using these keys:
- fill: one of "solid","linear","radial"
- shape: one of "none","rings","blobs","waves","dots","mesh","arcs","triangles","grid","zigzag","bubbles" (use "none" for a clean solid or gradient look)
- color: the fill hex — the solid color, or the gradient START. Prefer soft, light tints that match the vibe; use a deep/dark color only for genuinely moody or premium vibes (text contrast is handled automatically).
- gradientColor: the gradient END hex (used only when fill is "linear" or "radial"); it should differ clearly from color.
- accent: the SHAPE color hex (used only when shape isn't "none"); it MUST contrast the fill so the shapes are visible.
- accentOpacity: number 0.25..0.6 (subtle reads best)
- density: integer 1..8 (how busy the shape is)
- ringLayout: one of "calm","anchor-low","drift","bookends","center-stage","constellation","march" (rings only)
- ringCount: integer 1..8 (rings only)
- gradientAngle: integer 0..360 (linear only)
- seed: any integer
- note: one short sentence (max ~140 chars) explaining why this fits the vibe
Choose fill, shape, and palette that suit the description. Output JSON only.`;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || undefined;
  const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers });
  }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), { status: 429, headers });
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt.slice(0, 400).trim() : "";
  if (!prompt) return new Response(JSON.stringify({ error: "Missing prompt" }), { status: 400, headers });

  const provider = body?.provider === "cerebras" ? "cerebras" : "groq";

  // BYOK: a user-supplied Groq key is used for this request only, never stored.
  const byok = typeof body?.key === "string" && body.key.startsWith("gsk_") ? body.key : "";
  const apiKey = provider === "cerebras" ? SERVER_CEREBRAS_KEY : (byok || SERVER_GROQ_KEY);
  const apiUrl = provider === "cerebras" ? CEREBRAS_URL : GROQ_URL;
  const model = provider === "cerebras" ? CEREBRAS_MODEL : MODEL;

  if (!apiKey) {
    const missing = provider === "cerebras" ? "CEREBRAS_API_KEY" : "GROQ_API_KEY";
    return new Response(JSON.stringify({ error: `No ${missing} configured` }), { status: 500, headers });
  }

  try {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_completion_tokens: 350,
        response_format: { type: "json_object" },
        stream: false,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      const providerLabel = provider === "cerebras" ? "Cerebras" : "Groq";
      return new Response(
        JSON.stringify({ error: `${providerLabel} error ${resp.status}`, detail: detail.slice(0, 300) }),
        { status: 502, headers },
      );
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    // deno-lint-ignore no-explicit-any
    let parsed: any = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = {};
    }
    const note = typeof parsed?.note === "string" ? parsed.note.trim().slice(0, 200) : "";
    const params = validate(parsed);
    const text = deriveText(params.fill, params.color, params.gradientColor);
    return new Response(JSON.stringify({ params, note, text }), { headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers },
    );
  }
});
