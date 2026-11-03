// Web Push to a person's subscribed devices (docs/api/notifications.md §1b,
// "Web Push"). Used by the backend (Send test) and the worker (reminders).
import { createHash } from "node:crypto";
import webpush from "web-push";
import { secretIfSet } from "./env.js";
import { NotificationError, type NotificationMessage } from "./notify.js";

export interface VapidSettings {
  publicKey: string;
  privateKey: string;
  subject: string; // mailto: or https:, how a push service can reach whoever runs the server
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const TIMEOUT_MS = 10_000;
const TTL_SECONDS = 24 * 60 * 60;

// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (or _FILE) and VAPID_SUBJECT: all three
// or none. None = Web Push off.
export function vapidFromEnv(): VapidSettings | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || undefined;
  const privateKey = secretIfSet("VAPID_PRIVATE_KEY");
  const subject = process.env.VAPID_SUBJECT?.trim() || undefined;
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together (or none, for no Web Push)");
  }
  if (!/^(mailto:|https:\/\/)/.test(subject)) throw new Error("VAPID_SUBJECT must be a mailto: address or an https:// URL");
  return { publicKey, privateKey, subject };
}

// How a device is recognised without handing its endpoint back.
export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

// The push service says the subscription no longer exists: drop the device.
export class PushGoneError extends NotificationError {}

// Throws PushGoneError for 404/410, NotificationError otherwise.
export async function sendWebPush(target: PushTarget, vapid: VapidSettings, message: NotificationMessage): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(message),
      { vapidDetails: vapid, TTL: TTL_SECONDS, timeout: TIMEOUT_MS }
    );
  } catch (err) {
    if (err instanceof webpush.WebPushError) {
      if (err.statusCode === 404 || err.statusCode === 410) throw new PushGoneError("says the device is no longer subscribed");
      throw new NotificationError(`answered ${err.statusCode}`);
    }
    throw new NotificationError(`couldn't reach it (${err instanceof Error ? err.message : String(err)})`);
  }
}
