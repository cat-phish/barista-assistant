/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Backend on another origin, e.g. http://localhost:3000. Unset = same
  // origin (/api through the dev proxy or a reverse proxy).
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
