/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BG_PROMPT_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_GATE_PASSWORD_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
