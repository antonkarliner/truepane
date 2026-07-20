// Runtime-agnostic client for the AI Edge Functions (generator-bg-prompt,
// generator-translate). Only uses fetch (browser + Node 18+); endpoint URLs
// and the anon key are injected by the caller — the browser wrapper
// (src/ai.ts) reads import.meta.env, the MCP server reads process.env.
import type { Background, SlideText } from "./types";

export interface AiEndpoints {
  bgPromptUrl?: string;
  translateUrl?: string;
  anonKey?: string;
}

export type AiProvider = "groq" | "cerebras";

export interface AiResult {
  params: Partial<Background>;
  note: string;
  /** Legible title/subhead colors derived from the chosen background. */
  text: { titleColor: string; subheadColor: string } | null;
}

function authHeaders(anonKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (anonKey) {
    headers["apikey"] = anonKey;
    headers["Authorization"] = `Bearer ${anonKey}`;
  }
  return headers;
}

export async function requestBackground(
  endpoints: AiEndpoints,
  prompt: string,
  provider: AiProvider = "groq",
  byokKey?: string,
): Promise<AiResult> {
  if (!endpoints.bgPromptUrl) throw new Error("AI endpoint not configured.");

  const res = await fetch(endpoints.bgPromptUrl, {
    method: "POST",
    headers: authHeaders(endpoints.anonKey),
    body: JSON.stringify({
      prompt,
      provider,
      ...(byokKey && provider === "groq" ? { key: byokKey } : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  const text =
    data.text && typeof data.text.titleColor === "string" && typeof data.text.subheadColor === "string"
      ? { titleColor: data.text.titleColor, subheadColor: data.text.subheadColor }
      : null;
  return {
    params: mapAiParams(data.params),
    note: typeof data.note === "string" ? data.note : "",
    text,
  };
}

// The endpoint returns validated/clamped fill + shape params; copy the known
// keys into a Background patch (light type-guarding; values are already clamped).
export function mapAiParams(raw: unknown): Partial<Background> {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<Background> = {};
  if (p.fill === "solid" || p.fill === "linear" || p.fill === "radial") out.fill = p.fill;
  if (typeof p.shape === "string") out.shape = p.shape as Background["shape"];
  if (typeof p.color === "string") out.color = p.color;
  if (typeof p.gradientColor === "string") out.gradientColor = p.gradientColor;
  if (typeof p.accent === "string") out.accent = p.accent;
  if (typeof p.accentOpacity === "number") out.accentOpacity = p.accentOpacity;
  if (typeof p.density === "number") out.density = p.density;
  if (typeof p.ringLayout === "string") out.ringLayout = p.ringLayout;
  if (typeof p.ringCount === "number") out.ringCount = p.ringCount;
  if (typeof p.gradientAngle === "number") out.gradientAngle = p.gradientAngle;
  if (typeof p.seed === "number") out.seed = p.seed;
  return out;
}

// Translate a set of slide title/subhead pairs into one target language. The
// endpoint returns an array aligned to the input order; we fall back to the
// source string for any field the model leaves blank, so a partial response
// still yields a usable result.
export async function requestTranslation(
  endpoints: AiEndpoints,
  items: SlideText[],
  targetLanguage: string,
  context: string,
  provider: AiProvider = "groq",
  byokKey?: string,
): Promise<{ items: SlideText[]; note: string }> {
  if (!endpoints.translateUrl) throw new Error("Translate endpoint not configured.");

  const res = await fetch(endpoints.translateUrl, {
    method: "POST",
    headers: authHeaders(endpoints.anonKey),
    body: JSON.stringify({
      items,
      targetLanguage,
      context,
      provider,
      ...(byokKey && provider === "groq" ? { key: byokKey } : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);

  const raw = Array.isArray(data.items) ? data.items : [];
  const out: SlideText[] = items.map((src, i) => {
    const r = (raw[i] && typeof raw[i] === "object" ? raw[i] : {}) as Record<string, unknown>;
    const title = typeof r.title === "string" && r.title.trim() ? r.title.trim() : src.title;
    const subhead = typeof r.subhead === "string" && r.subhead.trim() ? r.subhead.trim() : src.subhead;
    return { title, subhead };
  });

  return { items: out, note: typeof data.note === "string" ? data.note : "" };
}
