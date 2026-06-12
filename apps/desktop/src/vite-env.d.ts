/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  readonly TAURI_DEV_HOST?: string;
  readonly TAURI_PLATFORM?: string;
  readonly TAURI_DEBUG?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
