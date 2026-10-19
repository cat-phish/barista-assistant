/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Backend origin, e.g. http://localhost:3000 (docker-compose.yml sets it).
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
