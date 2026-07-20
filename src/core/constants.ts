import type { AppState, FontOption, LanguageTarget } from "./types";

export const STORAGE_KEY = "appstore-generator-v1";

// Common App Store / Google Play storefront locales for the AI translate feature.
// `code` is used for ZIP folder names and as the translations map key; `name` is
// the human label sent to the model. Users can also add a custom language.
export const TRANSLATE_LANGUAGES: LanguageTarget[] = [
  { code: "es", name: "Spanish" },
  { code: "es-MX", name: "Spanish (Mexico)" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt-BR", name: "Brazilian Portuguese" },
  { code: "pt-PT", name: "Portuguese (Portugal)" },
  { code: "nl", name: "Dutch" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "no", name: "Norwegian" },
  { code: "fi", name: "Finnish" },
  { code: "pl", name: "Polish" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh-Hans", name: "Simplified Chinese" },
  { code: "zh-Hant", name: "Traditional Chinese" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "id", name: "Indonesian" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
];

export const DEFAULT_SLIDES: { title: string; subhead: string }[] = [
  { title: "Your Headline Here", subhead: "A short, benefit-driven subhead for this screen." },
  { title: "Show Off a Feature", subhead: "Describe what the user sees in one tight sentence." },
  { title: "Make It Effortless", subhead: "Explain the value, not the mechanics." },
  { title: "Build Trust", subhead: "Ratings, social proof, or a reassuring detail." },
  { title: "Drive the Action", subhead: "Tell them exactly what to do next." },
];

export const FONT_OPTIONS: FontOption[] = [
  { id: "-apple-system", label: "San Francisco (Apple system)" },
  { id: "Roboto", label: "Roboto (Android system)", google: "Roboto:wght@400;500;700" },
  { id: "Inter", label: "Inter", google: "Inter:wght@400;500;600;700" },
  { id: "Plus Jakarta Sans", label: "Plus Jakarta Sans", google: "Plus+Jakarta+Sans:wght@400;500;600;700" },
  { id: "DM Sans", label: "DM Sans", google: "DM+Sans:wght@400;500;700" },
  { id: "Manrope", label: "Manrope", google: "Manrope:wght@400;500;600;700" },
  { id: "Bricolage Grotesque", label: "Bricolage Grotesque", google: "Bricolage+Grotesque:wght@400;500;600;700" },
  { id: "Space Grotesk", label: "Space Grotesk", google: "Space+Grotesk:wght@400;500;700" },
  { id: "Instrument Serif", label: "Instrument Serif", google: "Instrument+Serif" },
  { id: "Newsreader", label: "Newsreader", google: "Newsreader:opsz,wght@6..72,400;6..72,600;6..72,700" },
  { id: "Fraunces", label: "Fraunces", google: "Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700" },
  { id: "Source Serif 4", label: "Source Serif 4", google: "Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700" },
  { id: "Noto Sans", label: "Noto Sans (multi-script)", google: "Noto+Sans:wght@400;500;600;700" },
  { id: "Noto Serif", label: "Noto Serif (multi-script)", google: "Noto+Serif:wght@400;600;700" },
  { id: "Noto Sans Arabic", label: "Noto Sans Arabic (العربية)", google: "Noto+Sans+Arabic:wght@400;500;700" },
  { id: "Noto Sans SC", label: "Noto Sans SC (简体中文)", google: "Noto+Sans+SC:wght@400;500;700", heavy: true },
  { id: "Noto Sans JP", label: "Noto Sans JP (日本語)", google: "Noto+Sans+JP:wght@400;500;700", heavy: true },
  { id: "Noto Sans KR", label: "Noto Sans KR (한국어)", google: "Noto+Sans+KR:wght@400;500;700", heavy: true },
];

// Curated light-background palettes grounded in colour relationships
// (analogous, complementary, monochrome, warm/cool) rather than trademarked
// brand values. Each pairs a soft background with an accent that stays legible.
export const BG_PRESETS: { name: string; color: string; accent: string }[] = [
  { name: "Cream", color: "#f3ece1", accent: "#c4623b" }, // warm analogous (earthy)
  { name: "Espresso", color: "#f5f1ea", accent: "#4a342a" }, // warm neutral, high contrast
  { name: "Mist", color: "#eef1f6", accent: "#3a4ea8" }, // cool, calm indigo
  { name: "Sage", color: "#e9ede2", accent: "#4f6346" }, // green monochrome
  { name: "Blush", color: "#f8e9e6", accent: "#c25064" }, // soft warm rose
  { name: "Sky", color: "#e9f1f7", accent: "#2f6fb0" }, // airy blue
  { name: "Butter", color: "#fbf3df", accent: "#e07a2e" }, // sunny warm analogous
  { name: "Lavender", color: "#efebf7", accent: "#6a4ea8" }, // calm violet
  { name: "Mint", color: "#e6f1ec", accent: "#2e8b7a" }, // fresh teal
  { name: "Peach", color: "#fde7df", accent: "#e2654d" }, // playful coral
  { name: "Slate", color: "#eef0f2", accent: "#46505c" }, // minimal grayscale mono
  { name: "Plum", color: "#f4ecde", accent: "#7a3b6a" }, // warm bg + cool complementary pop
];

export function defaultState(): AppState {
  return {
    slides: DEFAULT_SLIDES.map((s) => ({ ...s, image: null, imageDataUrl: null })),
    settings: {
      platform: "ios",
      fontFamily: "Inter",
      customFont: null,
      titleColor: "#1a1612",
      titleScale: 1,
      subheadColor: "rgba(26,22,18,0.62)",
      subtitleScale: 1,
      background: {
        fill: "solid",
        shape: "none",
        color: "#f2eee6",
        gradientColor: "#c9d6e8",
        accent: "#c47c3b",
        accentOpacity: 0.55,
        ringLayout: "calm",
        ringCount: 4,
        seed: 1,
        density: 3,
        dotsAligned: false,
        gradientAngle: 135,
      },
    },
  };
}
