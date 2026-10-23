// The notification services a person can set up (docs/api/notifications.md
// §1b), described for the settings form, and whether Rate later can remind.
import type { NotificationChannel, NotificationKind, UserPreferences } from '../api/types';

export interface ServiceField {
  key: string;
  label: string;
  placeholder?: string;
  optional?: boolean;
  secret?: boolean; // masked by the API; shown as a password field
}

export interface Service {
  kind: NotificationKind;
  name: string;
  hint: string;
  fields: ServiceField[];
}

// In the API's order (NOTIFICATION_KINDS).
export const SERVICES: Service[] = [
  {
    kind: 'ntfy',
    name: 'ntfy',
    hint: 'Free push notifications: install the ntfy app, subscribe to a topic, enter it here. Use ntfy.sh or your own server.',
    fields: [
      { key: 'server', label: 'Server', placeholder: 'https://ntfy.sh' },
      { key: 'topic', label: 'Topic', placeholder: 'e.g. my-coffee-7f3k (hard to guess)' },
      { key: 'token', label: 'Access token', optional: true, secret: true, placeholder: 'only for protected topics' },
    ],
  },
  {
    kind: 'gotify',
    name: 'Gotify',
    hint: 'Your self-hosted Gotify server and an application token from it.',
    fields: [
      { key: 'server', label: 'Server', placeholder: 'https://gotify.example.com' },
      { key: 'appToken', label: 'App token', secret: true },
    ],
  },
  {
    kind: 'pushover',
    name: 'Pushover',
    hint: 'Your user key, and the API token of an application you create on pushover.net.',
    fields: [
      { key: 'userKey', label: 'User key', secret: true },
      { key: 'appToken', label: 'App API token', secret: true },
    ],
  },
  {
    kind: 'discord',
    name: 'Discord',
    hint: "A channel's webhook URL (channel settings → Integrations → Webhooks).",
    fields: [{ key: 'url', label: 'Webhook URL', secret: true, placeholder: 'https://discord.com/api/webhooks/…' }],
  },
  {
    kind: 'telegram',
    name: 'Telegram',
    hint: 'A bot token from @BotFather, and the chat to message (your user ID, or a group or channel the bot is in).',
    fields: [
      { key: 'botToken', label: 'Bot token', secret: true },
      { key: 'chatId', label: 'Chat ID', placeholder: 'e.g. 123456789 or @mychannel' },
    ],
  },
  {
    kind: 'slack',
    name: 'Slack',
    hint: 'An incoming webhook URL for the channel.',
    fields: [{ key: 'url', label: 'Webhook URL', secret: true, placeholder: 'https://hooks.slack.com/services/…' }],
  },
  {
    kind: 'webhook',
    name: 'Webhook',
    hint: 'Any URL: it gets a POST with { title, message, url } as JSON (Home Assistant, n8n, Apprise…).',
    fields: [{ key: 'url', label: 'URL', secret: true, placeholder: 'https://…' }],
  },
];

// Rate later is offered when reminders are on and something can deliver them.
export function canRemind(prefs: Pick<UserPreferences, 'rateReminders'>, channels: Pick<NotificationChannel, 'enabled'>[]): boolean {
  return prefs.rateReminders && channels.some((c) => c.enabled);
}

// The form's starting values: the saved config, or blanks (ntfy's server
// defaults to ntfy.sh).
export function formValues(service: Service, saved: NotificationChannel | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of service.fields) out[f.key] = saved?.config[f.key] ?? (service.kind === 'ntfy' && f.key === 'server' ? 'https://ntfy.sh' : '');
  return out;
}

// What's sent: trimmed, blank optional fields as null.
export function configFromForm(service: Service, values: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of service.fields) {
    const v = (values[f.key] ?? '').trim();
    out[f.key] = v === '' && f.optional ? null : v;
  }
  return out;
}

// "15 min", "1 h", "1 h 30 min".
export function formatDelay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}
