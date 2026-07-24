/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RAG_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
