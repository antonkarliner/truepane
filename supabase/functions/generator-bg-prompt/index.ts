// Edge function for the App Store Strip Generator: turns a short text prompt
// into validated background-style parameters via Groq, returning ONLY a
// schema-checked, clamped object (raw model output never reaches the client
// renderer). Self-contained on purpose — no shared imports — so it can live in
// any Supabase project without coupling to that project's other env vars.
//
// Secrets: GROQ_API_KEY (already set in this project). Optional override:
// BG_PROMPT_MODEL. Deployed with verify_jwt=false (public, anonymous tool).

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = Deno.env.get("BG_PROMPT_MODEL") || "llama-3.3-70b-versatile";
const SERVER_GROQ_KEY = Deno.env.get("GROQ_API_KEY") || "";

const PATTERNS = ["solid", "rings", "blobs", "waves", "dots", "mesh"];
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
// Text colors derived from the background so every scheme stays legible —
// dark backgrounds get light text, light backgrounds get dark text.
function deriveText(bgHex: string): { titleColor: string; subheadColor: string } {
  return luminance(bgHex) < 0.5
    ? { titleColor: "#ffffff", subheadColor: "rgba(255,255,255,0.72)" }
    : { titleColor: "#1a1612", subheadColor: "rgba(26,22,18,0.62)" };
}
// Push the accent away from the background if they're too close in lightness,
// so the pattern stays visible (e.g. blue shapes on a blue background).
function ensureAccentContrast(accentHex: string, bgHex: string): string {
  const lb = luminance(bgHex);
  if (Math.abs(luminance(accentHex) - lb) >= 0.2) return accentHex;
  const [r, g, b] = hexToRgb(accentHex);
  const target = lb > 0.5 ? 0 : 255; // light bg → darken accent; dark bg → lighten
  const t = 0.5;
  return rgbToHex(r * (1 - t) + target * t, g * (1 - t) + target * t, b * (1 - t) + target * t);
}

function corsHeaders(origin?: string): Record<string, string> {
  // Reflect the request origin. Abuse is bounded by rate limiting + the server
  // key, not CORS (which doesn't stop non-browser clients anyway). Tighten to
  // an allowlist here if you ever need to.
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Best-effort in-memory rate limit (per isolate; resets on cold start). Good
// enough to blunt casual abuse; swap for a Supabase table or Upstash before a
// high-traffic public launch.
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
  return {
    pattern: PATTERNS.includes(raw?.pattern) ? raw.pattern : "blobs",
    color: HEX.test(raw?.color) ? raw.color : "#f2eee6",
    accent: HEX.test(raw?.accent) ? raw.accent : "#c47c3b",
    accentOpacity: clampNum(raw?.accentOpacity, 0, 1, 0.55),
    density: clampInt(raw?.density, 1, 8, 3),
    ringLayout: RING_LAYOUTS.includes(raw?.ringLayout) ? raw.ringLayout : "calm",
    ringCount: clampInt(raw?.ringCount, 1, 8, 4),
    seed: Number.isFinite(Number(raw?.seed)) ? Math.floor(Number(raw.seed)) : Math.floor(Math.random() * 1e9),
  };
}

const SYSTEM = `You translate a short mood/description into background style parameters for an App Store screenshot generator. The background sits BEHIND a phone mockup and below the app's title text, so it must stay tasteful and never overpower the screenshot. Respond ONLY with a JSON object (no prose) using these keys:
- pattern: one of "solid","rings","blobs","waves","dots","mesh"
- color: the background hex. PREFER a soft, light tint that matches the vibe (warm cream for cozy, cool off-white for tech, pale blush for playful) rather than plain gray. Use a deep/dark color ONLY for genuinely moody or premium vibes (e.g. "cyberpunk", "jazz at 2am"); text contrast is handled automatically, so don't worry about legibility.
- accent: the shape color. It MUST clearly contrast the background so the pattern is visible — more saturated and darker than a light background, or brighter than a dark one. Never pick an accent with nearly the same lightness as the background.
- accentOpacity: number 0.25..0.6 (subtle reads best)
- density: integer 1..8 (how busy the pattern is)
- ringLayout: one of "calm","anchor-low","drift","bookends","center-stage","constellation","march" (rings only — vary it to suit the vibe)
- ringCount: integer 1..8 (rings only)
- seed: any integer
- note: one short sentence (max ~140 chars) explaining why this palette/style fits the vibe
Output JSON only.`;

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

  // BYOK: a user-supplied Groq key is used for this request only, never stored.
  const byok = typeof body?.key === "string" && body.key.startsWith("gsk_") ? body.key : "";
  const apiKey = byok || SERVER_GROQ_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "No Groq API key configured" }), { status: 500, headers });
  }

  try {
    const resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_completion_tokens: 300,
        response_format: { type: "json_object" },
        stream: false,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return new Response(
        JSON.stringify({ error: `Groq error ${resp.status}`, detail: detail.slice(0, 300) }),
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
    params.accent = ensureAccentContrast(params.accent, params.color);
    const text = deriveText(params.color);
    return new Response(JSON.stringify({ params, note, text }), { headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers },
    );
  }
});
