# 1b. Notifications

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Each person sets up where their reminders go: one **channel** per service,
each with its own on/off. Today they deliver **rate-later reminders**: a
brew saved with "Rate later" (§6 `remindToRate`) gets a reminder after the
person's delay, unless it has been rated by then.

Channels belong to a person, not a workspace: they're under
`/api/auth/me/…` like preferences (§1), and nobody else can see them.

## Services

`kind` is one of `NOTIFICATION_KINDS`. Each has its own `config`; every
field is a string unless marked:

| `kind` | `config` | Sent as |
|---|---|---|
| `ntfy` | `server` (http(s) URL, default `https://ntfy.sh`), `topic` (letters, numbers, `-`, `_`, ≤ 64), `token` (optional, nullable) | JSON publish to the server root: `topic`, `title`, `message`, `click` (the link), `tags: ["coffee"]`; `Authorization: Bearer <token>` |
| `gotify` | `server` (http(s) URL), `appToken` | `POST <server>/message` with `X-Gotify-Key`; the link as `client::notification` click |
| `pushover` | `userKey`, `appToken` | `POST https://api.pushover.net/1/messages.json` with `url` |
| `discord` | `url` (a channel webhook) | `{ content }`: title, message and link as lines |
| `telegram` | `botToken`, `chatId` | `POST https://api.telegram.org/bot<token>/sendMessage` `{ chat_id, text }` |
| `slack` | `url` (an incoming webhook) | `{ text }` |
| `webhook` | `url` (any http(s) URL) | `{ title, message, url }` as JSON |

Every request is a JSON `POST` with a 10 s timeout. Redirects aren't
followed. Only the service's status is reported back, never its response.

**Server-side requests:** the server sends to addresses a member sets up
(their own ntfy, Gotify or webhook URL). They must be `http`/`https`, but
LAN addresses are allowed, since self-hosted ntfy and Gotify usually run on
the LAN. Whoever runs the server should know that any member can make it
`POST` to a URL of their choosing.

**Masked secrets:** credentials (`SECRET_FIELDS`: ntfy `token`, Gotify
`appToken`, Pushover `userKey` and `appToken`, Telegram `botToken`, and the
Discord, Slack and webhook `url`) come back as `"••••"` plus their last 4
characters (just `"••••"` for 8 characters or fewer). Sending a masked value
back unchanged keeps the stored one, so a form can be saved without
retyping it.

**Channel object:**

```json
{ "kind": "ntfy", "enabled": true, "config": { "server": "https://ntfy.sh", "topic": "my-coffee", "token": "••••1234" }, "createdAt": "…" }
```

## `GET /api/auth/me/notifications`

- **Auth Required:** `true`
- **Success (`200 OK`):** `{ "channels": [ ...channel ] }`: the caller's own,
  in `NOTIFICATION_KINDS` order. `[]` when none are set up.

## `PUT /api/auth/me/notifications/:kind`

Sets up or changes the caller's channel of that kind (one per kind).

- **Auth Required:** `true`
- **Body:** `{ "enabled": true, "config": { … } }`. `enabled` defaults to
  `true`; `config` is checked against the kind's fields above, after masked
  secrets are filled back in.
- **Success (`200 OK`):** `{ "channel": { ...channel } }`
- **Errors:** `400` invalid config (the message names the field); `404`
  unknown `kind`.

## `DELETE /api/auth/me/notifications/:kind`

- **Auth Required:** `true`
- **Success (`204 No Content`)**
- **Errors:** `404` unknown kind, or not set up.

## `POST /api/auth/me/notifications/:kind/test`

Sends "Test from Barista" through the saved channel, enabled or not.

- **Auth Required:** `true`
- **Success (`204 No Content`)**: the service accepted it.
- **Errors:** `404` unknown kind or not set up; `502` the service refused it
  or couldn't be reached. `error` says which, e.g. `"The service answered
  401 Unauthorized"`, `"The service couldn't reach it (…)"` or `"no answer
  within 10 s"`.

## Rate-later reminders

- **Preferences** (§1, `PATCH /api/auth/me/preferences`):
  - `rateReminders` (boolean, default `true`): whether Rate later is
    offered and reminders sent;
  - `rateReminderMinutes` (integer 5–240, default `15`): the delay.
- **Queuing:** `POST /brew-logs` with `"remindToRate": true` (§6) queues a
  delayed BullMQ job (`REMINDER_QUEUE`, job `rate-brew`, id
  `rate-<brewLogId>`, data `{ brewLogId, userId }`), but only when the
  caller has `rateReminders` on and at least one enabled channel. The reply
  says what happened:
  - `reminder: "queued"`;
  - `"off"`: no enabled channel, or reminders switched off;
  - `"unavailable"`: the queue couldn't be reached.

  The brew is saved either way.
- **Sending:** when the job runs, the worker skips it if the brew has been
  deleted, has a `rating` or `drinkRating`, or the person turned reminders
  off.
  - Otherwise it sends to each enabled channel:
    - title "How was it? Rate your brew";
    - message "V60 · Onyx Guji · 8:42" (the drink or brewer, the bean, and
      the brew's local time);
    - link `<APP_URL>/journal/<brewLogId>`, which opens the brew's quick
      rating. Without `APP_URL` there's no link.
  - One channel failing doesn't stop the others. If every channel fails,
    the job is retried (3 attempts, backing off from 30 s).
- **Clients** offer **Save, rate later** only when the person has
  `rateReminders` on and an enabled channel. They don't offer the AI
  analysis until the brew is rated.
