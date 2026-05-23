// Edge function for Truepane: translates a set of slide title/subhead pairs into
// a target language via Groq or Cerebras, returning ONLY a length-matched array
// of {title, subhead} (raw model output is shape-checked before it reaches the
// client). Self-contained on purpose — no shared imports — so it can live in any
// Supabase project without coupling to that project's other env vars.
//
// Secrets: GROQ_API_KEY / CEREBRAS_API_KEY (shared with generator-bg-prompt).
// Optional override: BG_PROMPT_MODEL. Deployed with verify_jwt=false.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const MODEL = Deno.env.get("BG_PROMPT_MODEL") || "llama-3.3-70b-versatile";
const CEREBRAS_MODEL = "gpt-oss-120b";
const SERVER_GROQ_KEY = Deno.env.get("GROQ_API_KEY") || "";
const SERVER_CEREBRAS_KEY = Deno.env.get("CEREBRAS_API_KEY") || "";

const MAX_ITEMS = 20;
const MAX_FIELD = 400;

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

interface SlideText {
  title: string;
  subhead: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.slice(0, MAX_FIELD) : "";
}

const SYSTEM = `You are an expert app marketing localizer. You translate App Store / Google Play screenshot captions (a "title" and a short "subhead") into a target language. Rules:
- Translate the MEANING and marketing punch, not word-for-word. Keep titles short and punchy; keep each subhead to roughly one tight sentence.
- Preserve tone and intent. Do NOT translate brand names, product names, or proper nouns.
- Do not add quotes, markdown, emojis, or commentary inside the strings.
- Return ONLY a JSON object: { "items": [ { "title": "...", "subhead": "..." }, ... ], "note": "..." }
- The "items" array MUST have exactly the same length as the input and stay in the SAME order. The "note" is one short sentence (max ~140 chars) about the localization.
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

  const targetLanguage = typeof body?.targetLanguage === "string" ? body.targetLanguage.slice(0, 80).trim() : "";
  if (!targetLanguage) {
    return new Response(JSON.stringify({ error: "Missing targetLanguage" }), { status: 400, headers });
  }

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  const items: SlideText[] = rawItems
    .slice(0, MAX_ITEMS)
    // deno-lint-ignore no-explicit-any
    .map((it: any) => ({ title: str(it?.title), subhead: str(it?.subhead) }));
  if (items.length === 0) {
    return new Response(JSON.stringify({ error: "Missing items" }), { status: 400, headers });
  }

  const context = typeof body?.context === "string" ? body.context.slice(0, 600).trim() : "";
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

  const userContent = JSON.stringify({
    targetLanguage,
    context: context || undefined,
    items,
  });

  try {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        max_completion_tokens: 1500,
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

    const out = Array.isArray(parsed?.items) ? parsed.items : [];
    // Align to input length and fall back to the source string for blanks, so a
    // short or malformed response still produces a usable, length-matched array.
    const result: SlideText[] = items.map((src, i) => {
      const r = out[i] && typeof out[i] === "object" ? out[i] : {};
      const title = typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, MAX_FIELD) : src.title;
      const subhead = typeof r.subhead === "string" && r.subhead.trim()
        ? r.subhead.trim().slice(0, MAX_FIELD)
        : src.subhead;
      return { title, subhead };
    });
    const note = typeof parsed?.note === "string" ? parsed.note.trim().slice(0, 200) : "";
    return new Response(JSON.stringify({ items: result, note }), { headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers },
    );
  }
});
