import { connectionSettings, requireSecret } from "@barista/shared/env";

// Secrets accept NAME or NAME_FILE (Docker secrets); see shared/src/env.ts.
const jwtSecret = requireSecret("JWT_SECRET");
if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters");
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  redis: connectionSettings("REDIS_URL", "REDIS_PASSWORD"),
  // Only needed when the frontend calls the API on another origin (an
  // absolute VITE_API_URL); through the dev proxy or a reverse proxy the
  // requests are same-origin.
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // How many proxies in front of the backend to trust for the client IP
  // (X-Forwarded-For), e.g. 1 behind the Vite dev proxy or one reverse proxy.
  // The login rate limit is per client IP. Unset = trust none.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 0,
  isProduction: process.env.NODE_ENV === "production",
  jwtSecret,
} as const;

// Switches read on each call, so tests can change them.
// ALLOW_REGISTRATION=false closes sign-ups (docs/api/auth.md §1).
export const registrationOpen = (): boolean => process.env.ALLOW_REGISTRATION?.trim().toLowerCase() !== "false";
// BACKUP_DOWNLOADS=false keeps database dumps on the server: admins can't
// download them through the app (docs/api/server.md §10).
export const backupDownloadsEnabled = (): boolean => process.env.BACKUP_DOWNLOADS?.trim().toLowerCase() !== "false";
// How long a preview waits for the worker (docs/api/analysis.md §8d).
export const previewTimeoutMs = (): number => Number(process.env.AI_PREVIEW_TIMEOUT_MS ?? 10_000);
// How long reading a bean label may take (docs/api/bean-label.md §4d): a vision call.
export const labelReadTimeoutMs = (): number => Number(process.env.LABEL_READ_TIMEOUT_MS ?? 60_000);
// Where scheduled database dumps are written (the worker) and listed from.
export const backupDir = (): string => process.env.BACKUP_DIR ?? "/backups";
// Where bean photos are kept (docs/api/bean-photos.md §4c).
export const photoDir = (): string => process.env.PHOTO_DIR ?? "/photos";
// The zone the backup hour is in; an unknown zone falls back to UTC.
export function backupTimezone(): string {
  const tz = process.env.BACKUP_TIMEZONE?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}
