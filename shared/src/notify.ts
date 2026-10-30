// Sending a notification through one of a person's channels
// (docs/api/notifications.md §1b). Used by the backend (Send test) and the
// worker (rate reminders). Plain HTTP requests: each service's documented
// JSON API, 10 s timeout, http(s) only, redirects not followed.
import type { NotificationConfigs, NotificationKind } from "./schema.js";

export interface NotificationMessage {
  title: string;
  message: string;
  url: string | null; // opened when the notification is tapped, where supported
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 10_000;

export class NotificationError extends Error {}

function httpUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NotificationError("not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new NotificationError("only http and https URLs");
  return url.toString();
}
const trimSlash = (s: string) => httpUrl(s).replace(/\/+$/, "");

// One line of text for services without separate title and link fields.
function asText(m: NotificationMessage): string {
  return [m.title, m.message, m.url].filter(Boolean).join("\n");
}

function request(kind: NotificationKind, config: NotificationConfigs[NotificationKind], m: NotificationMessage): { url: string; headers: Record<string, string>; body: unknown } {
  switch (kind) {
    case "ntfy": {
      const c = config as NotificationConfigs["ntfy"];
      // JSON publishing to the server root keeps non-ASCII titles intact.
      return {
        url: trimSlash(c.server),
        headers: c.token ? { Authorization: `Bearer ${c.token}` } : {},
        body: { topic: c.topic, title: m.title, message: m.message, tags: ["coffee"], ...(m.url ? { click: m.url } : {}) },
      };
    }
    case "gotify": {
      const c = config as NotificationConfigs["gotify"];
      return {
        url: `${trimSlash(c.server)}/message`,
        headers: { "X-Gotify-Key": c.appToken },
        body: { title: m.title, message: m.message, priority: 5, ...(m.url ? { extras: { "client::notification": { click: { url: m.url } } } } : {}) },
      };
    }
    case "pushover": {
      const c = config as NotificationConfigs["pushover"];
      return {
        url: "https://api.pushover.net/1/messages.json",
        headers: {},
        body: { token: c.appToken, user: c.userKey, title: m.title, message: m.message, ...(m.url ? { url: m.url, url_title: "Open" } : {}) },
      };
    }
    case "discord":
      return { url: httpUrl((config as NotificationConfigs["discord"]).url), headers: {}, body: { content: asText(m) } };
    case "telegram": {
      const c = config as NotificationConfigs["telegram"];
      return { url: `https://api.telegram.org/bot${c.botToken}/sendMessage`, headers: {}, body: { chat_id: c.chatId, text: asText(m) } };
    }
    case "slack":
      return { url: httpUrl((config as NotificationConfigs["slack"]).url), headers: {}, body: { text: asText(m) } };
    case "webhook":
      return { url: httpUrl((config as NotificationConfigs["webhook"]).url), headers: {}, body: { title: m.title, message: m.message, url: m.url } };
  }
}

// Throws NotificationError with a short reason ("answered 401") on failure.
export async function sendNotification<K extends NotificationKind>(
  kind: K,
  config: NotificationConfigs[K],
  message: NotificationMessage,
  fetchImpl: Fetch = fetch
): Promise<void> {
  const r = request(kind, config, message);
  let res: Response;
  try {
    res = await fetchImpl(r.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...r.headers },
      body: JSON.stringify(r.body),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new NotificationError(timedOut ? "no answer within 10 s" : `couldn't reach it (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!res.ok) throw new NotificationError(`answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
}
