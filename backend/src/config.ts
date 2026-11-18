import { connectionSettings, requireSecret, secretIfSet } from "@barista/shared/env";
import { vapidFromEnv, type VapidSettings } from "@barista/shared/webPush";

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
  // Encrypts AI keys saved in Settings; without it, they can't be saved.
  aiConfigSecret: secretIfSet("AI_CONFIG_SECRET") ?? null,
} as const;

// Refuse to start with Web Push half set up.
vapidFromEnv();
// ...or with email verification on but nowhere to send the mail from.
if (process.env.EMAIL_VERIFICATION?.trim().toLowerCase() === "true" && (!process.env.SMTP_HOST?.trim() || !process.env.MAIL_FROM?.trim() || !process.env.APP_URL?.trim())) {
  throw new Error("EMAIL_VERIFICATION=true needs SMTP_HOST, MAIL_FROM and APP_URL (see .env.example)");
}

// Switches read on each call, so tests can change them.
// Web Push (docs/api/notifications.md §1b): the VAPID keys, or null = off.
export const webPushSettings = (): VapidSettings | null => vapidFromEnv();
// ALLOW_REGISTRATION: true (default) open, "invite" only an email with a
// pending workspace invite, false closed (docs/api/auth.md §1).
export type RegistrationMode = "open" | "invite" | "closed";
export function registrationMode(): RegistrationMode {
  const v = process.env.ALLOW_REGISTRATION?.trim().toLowerCase();
  return v === "false" ? "closed" : v === "invite" ? "invite" : "open";
}
export const registrationOpen = (): boolean => registrationMode() !== "closed";
// EMAIL_VERIFICATION=true: people confirm their address by a mailed link, and
// only a confirmed address can accept a workspace invite (docs/api/auth.md
// §1e). Off by default, so a server with no mail account works as before.
export const emailVerificationOn = (): boolean => process.env.EMAIL_VERIFICATION?.trim().toLowerCase() === "true";
// Where mailed links point; never taken from the request's Host header.
export const appUrl = (): string | null => (process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, "") : null);
// BACKUP_DOWNLOADS=false keeps database dumps on the server: admins can't
// download them through the app (docs/api/server.md §10).
export const backupDownloadsEnabled = (): boolean => process.env.BACKUP_DOWNLOADS?.trim().toLowerCase() !== "false";
// How long a preview waits for the worker (docs/api/analysis.md §8d).
export const previewTimeoutMs = (): number => Number(process.env.AI_PREVIEW_TIMEOUT_MS ?? 10_000);
// How long reading a bean label may take (docs/api/bean-label.md §4d): a vision call.
export const labelReadTimeoutMs = (): number => Number(process.env.LABEL_READ_TIMEOUT_MS ?? 60_000);
// A draft of a bean's Review (docs/api/analysis.md §8e).
export const beanReviewTimeoutMs = (): number => Number(process.env.BEAN_REVIEW_TIMEOUT_MS ?? 60_000);
// Turning text into research findings (docs/api/research.md §1f, "Drafts").
export const researchDraftTimeoutMs = (): number => Number(process.env.RESEARCH_DRAFT_TIMEOUT_MS ?? 60_000);
// A web lookup, its own request (§4d): searches take longer.
export const labelWebTimeoutMs = (): number => Number(process.env.LABEL_WEB_TIMEOUT_MS ?? 120_000);
// Where scheduled database dumps are written (the worker) and listed from.
export const backupDir = (): string => process.env.BACKUP_DIR ?? "/backups";
// Where bean photos are kept (docs/api/bean-photos.md §4c).
export const photoDir = (): string => process.env.PHOTO_DIR ?? "/photos";

// Your own Year in Coffee song (docs/api/auth.md §1, "Year song"): off unless
// YEAR_SONG_UPLOADS=true. Read per request, so tests can switch it.
export const yearSongUploadsOn = (): boolean => process.env.YEAR_SONG_UPLOADS?.trim().toLowerCase() === "true";
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
