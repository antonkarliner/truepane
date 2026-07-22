// Browser wrapper for the AI Edge Function clients in src/core/ai.ts: injects
// the Vite env config. The endpoints are optional: if unconfigured, the rest
// of the app works unchanged and the UI hides the feature.
import {
  requestBackground,
  requestTranslation,
  type AiEndpoints,
  type AiProvider,
  type AiResult,
} from "./core/ai";
import type { SlideText } from "./core/types";

export type { AiProvider, AiResult } from "./core/ai";

const AI_ENABLED = import.meta.env.VITE_ENABLE_AI === "true";

const ENDPOINTS: AiEndpoints = AI_ENABLED
  ? {
      bgPromptUrl: import.meta.env.VITE_BG_PROMPT_URL,
      translateUrl: import.meta.env.VITE_TRANSLATE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    }
  : {};

export const aiConfigured = Boolean(ENDPOINTS.bgPromptUrl);
export const translateConfigured = Boolean(ENDPOINTS.translateUrl);

export async function generateBackground(
  prompt: string,
  provider: AiProvider = "groq",
  byokKey?: string,
): Promise<AiResult> {
  if (!ENDPOINTS.bgPromptUrl) throw new Error("AI endpoint not configured (set VITE_BG_PROMPT_URL).");
  return requestBackground(ENDPOINTS, prompt, provider, byokKey);
}

export async function translateSlides(
  items: SlideText[],
  targetLanguage: string,
  context: string,
  provider: AiProvider = "groq",
  byokKey?: string,
): Promise<{ items: SlideText[]; note: string }> {
  if (!ENDPOINTS.translateUrl) throw new Error("Translate endpoint not configured (set VITE_TRANSLATE_URL).");
  return requestTranslation(ENDPOINTS, items, targetLanguage, context, provider, byokKey);
}
