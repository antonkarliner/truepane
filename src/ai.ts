// Client for the AI prompt→params Edge Function. Sends a short prompt, gets
// back validated background parameters. The endpoint is optional: if it isn't
// configured, the rest of the app works unchanged and the UI hides the feature.
import type { Background } from "./types";

const FN_URL = import.meta.env.VITE_BG_PROMPT_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const aiConfigured = Boolean(FN_URL);

export interface AiResult {
  params: Partial<Background>;
  note: string;
  /** Legible title/subhead colors derived from the chosen background. */
  text: { titleColor: string; subheadColor: string } | null;
}

export type AiProvider = "groq" | "cerebras";

export async function generateBackground(
  prompt: string,
  provider: AiProvider = "groq",
  byokKey?: string,
): Promise<AiResult> {
  if (!FN_URL) throw new Error("AI endpoint not configured (set VITE_BG_PROMPT_URL).");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ANON) {
    headers["apikey"] = ANON;
    headers["Authorization"] = `Bearer ${ANON}`;
  }

  const res = await fetch(FN_URL, {
    method: "POST",
    headers,
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
function mapAiParams(raw: unknown): Partial<Background> {
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
