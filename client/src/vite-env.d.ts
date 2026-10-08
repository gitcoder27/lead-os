/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the public landing page's "Request access" goes: an https:// or mailto: URL. Unset hides it. */
  readonly VITE_LEADOS_ACCESS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
