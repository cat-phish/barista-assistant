# 1b. Notifications

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Each person sets up where their reminders go: one **channel** per service,
each with its own on/off. Today they deliver **rate-later reminders**: a
brew saved with "Rate later" (§6 `remindToRate`) gets a reminder after the
person's delay, unless it has been rated by then; **steep reminders** for
cold brews; **resting beans** that are ready; and, for home roasting,
**low green stock** notices.

Channels belong to a person, not a workspace: they're under
`/api/auth/me/…` like preferences (§1), and nobody else can see them.

Besides the services below, the installed app itself can receive them as
native notifications: **Web Push**, one subscription per device (see
"Web Push" below). Wherever this page says "an enabled channel", an
enabled Web Push device counts too, while the server has Web Push set up.

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
the LAN. In Docker the requests come from the backend (test) and worker
(reminders) containers, where `localhost` is the container itself: a
service on the same machine is reached as `http://host.docker.internal:<port>`
(`docker-compose.yml` maps it to the host), one elsewhere on the LAN by its
address. Whoever runs the server should know that any member can make it
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
- **Success (`200 OK`):** `{ "channels": [ ...channel ], "pushDevices": [ ...device ] }`:
  the caller's own channels, in `NOTIFICATION_KINDS` order, and their Web
  Push devices, oldest first. `[]` when none are set up.

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

Sends "Test from Barista-Assistant" through the saved channel, enabled or not.

- **Auth Required:** `true`
- **Success (`204 No Content`)**: the service accepted it.
- **Errors:** `404` unknown kind or not set up; `502` the service refused it
  or couldn't be reached. `error` says which, e.g. `"The service answered
  401 Unauthorized"`, `"The service couldn't reach it (…)"` or `"no answer
  within 10 s"`.

## Web Push

The app (installed or in the browser) subscribes the device it's running
on, and reminders arrive as the device's own notifications. Tapping one
opens its link in the app. Each device is its own entry, with its own
on/off; every enabled one is notified.

- **Server setup:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (or
  `VAPID_PRIVATE_KEY_FILE`) and `VAPID_SUBJECT` (a `mailto:` address or an
  `https://` URL the push services can contact) on both backend and worker,
  all three or none. `npx web-push generate-vapid-keys` makes a key pair.
  Without them Web Push is off: the key route answers 404, and devices
  already saved are kept but not sent to. New keys silence every device until it
  subscribes again: a client whose subscription was made with other keys
  offers to subscribe again, and drops that device's old entry.
- **Where it works:** Chrome, Edge, Firefox and Safari on desktop, and
  Android; on iPhone and iPad (iOS 16.4+) only from the app added to the
  Home Screen, never a Safari tab. It needs HTTPS with a certificate the
  device trusts. Clients show why when the device can't subscribe, and
  still list the devices already saved.
- **Sending:** the server `POST`s an encrypted payload
  `{ "title", "message", "url" }` (as for the services above; `url` may be
  `null`) to the device's push service (Google, Mozilla, Apple, …), with a
  1-day TTL and a 10 s timeout. A push service answering `404` or `410`
  means the subscription is gone (the app was uninstalled, or permission
  withdrawn): the device is removed.
- **Device object** (the endpoint itself isn't returned; `endpointHash`,
  its SHA-256 in hex, lets a client recognise its own subscription):

```json
{ "id": "…", "label": "Android · Chrome", "enabled": true, "endpointHash": "3f2a…", "createdAt": "…" }
```

### `GET /api/auth/me/notifications/push/key`

- **Auth Required:** `true`
- **Success (`200 OK`):** `{ "publicKey": "BO…" }`, the VAPID public key
  for `pushManager.subscribe({ applicationServerKey })`.
- **Errors:** `404` Web Push isn't set up on this server.

### `POST /api/auth/me/notifications/push`

Saves this device's subscription (from `PushSubscription.toJSON()`).

- **Auth Required:** `true`
- **Body:** `{ "endpoint": "https://…", "keys": { "p256dh": "…", "auth": "…" }, "label": "Android · Chrome" }`:
  `endpoint` an `https` URL (≤ 1000), keys as base64url (≤ 200), `label`
  1–60 characters.
- **Success (`200 OK`):** `{ "device": { ...device } }`. The same endpoint
  sent again updates that device (keys and label, switched on), also when
  it was another person's: whoever subscribes a device last gets its
  notifications.
- **Errors:** `400` invalid body; `404` Web Push isn't set up.

### `PATCH /api/auth/me/notifications/push/:id`

- **Auth Required:** `true`
- **Body:** `{ "enabled": false }`
- **Success (`200 OK`):** `{ "device": { ...device } }`
- **Errors:** `400` invalid body; `404` not one of the caller's devices.

### `DELETE /api/auth/me/notifications/push/:id`

- **Auth Required:** `true`
- **Success (`204 No Content`)**
- **Errors:** `404` not one of the caller's devices.

### `POST /api/auth/me/notifications/push/:id/test`

Sends "Test from Barista-Assistant" to the device, enabled or not.

- **Auth Required:** `true`
- **Success (`204 No Content`)**: the push service accepted it.
- **Errors:** `404` not one of the caller's devices, or Web Push isn't set
  up; `410` the subscription is gone and the device was removed; `502` the
  push service refused it or couldn't be reached (`error` says which, as
  for the services above).

## Steep reminders

- **Preference:** `steepReminders` (boolean, default `true`).
- **Queuing:** `POST /brew-logs` with `steeping: true` (a long cold brew,
  §6) that has a steep window (its own `steepMinHours`, the recipe's
  unless changed for the brew) queues a delayed job on the same queue (job
  `steep-done`, id `steep-<brewLogId>`, data `{ brewLogId, userId }`).
  It's due `steepMinHours` after the brew's `timestamp`. It's only queued
  with `steepReminders` on and an enabled channel. The reply's
  `steepReminder` is `queued`, `off` or `unavailable`, and is left out
  when the brew has no window.
- **Sending:** skipped if the brew was deleted or finished (`steeping:
  false`), or steep reminders were turned off. Otherwise:
  - title "Your cold brew is ready to filter";
  - message "Cold brew · Onyx Guji · started 20:15";
  - a link to the entry, where **Finish** completes it.

## Rate-later reminders

- **Preferences** (§1, `PATCH /api/auth/me/preferences`):
  - `rateReminders` (boolean, default `true`): whether Rate later is
    offered and reminders sent;
  - `rateReminderMinutes` (integer 5–240, default `15`): the delay;
  - `rateLaterDefault` (boolean, default `false`): whether the Rate later
    box starts ticked.
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
- **Clients:** the brew log form shows a **Rate later** box when
  `rateReminders` is on (hidden when it's off).
  - It starts ticked or not per `rateLaterDefault`.
  - It's greyed out while the person has no enabled channel.
  - Saving with it ticked and no rating sends `remindToRate`.
  - Clients don't offer the AI analysis until the brew is rated.

## Resting beans

- **Preferences:** `restReminders` (boolean, default `true`) and
  `restReminderRepeatDays` (1–60 or `null`, default `null`), auth.md §1.
- **Scheduling:** a BullMQ job scheduler on the reminder queue
  (`bean-rest-tick`, cron `*/15 * * * *`), set when the backend starts. Each
  tick (`worker/src/beanRest.ts`) finds the resting beans (`beans.md` §4,
  "Resting"; not archived) whose `restingBy` is still a member, and works
  out that person's local day and time: their `timeZone`, else the
  workspace's, else `BREW_TIMEZONE`, else UTC.
- **Due:** from **8:00** on or after its `restingUntil` day, with
  `restReminders` on: the first time (`restLastRemindedOn` is `null`), then,
  with `restReminderRepeatDays` set, every that many days after the last
  one, until the bean is made active, frozen or archived. A new ready day
  starts over.
- **What's sent:** one notification per person and workspace for the beans
  due then; each bean's `restLastRemindedOn` becomes that local day.
  - title "Your beans are ready to brew" ("3 beans are ready to brew" for
    several);
  - message "Onyx · Geometry" (roaster · bean · batch), or "3 beans:
    Geometry, Guji (batch 3), …";
  - link `<APP_URL>/beans/resting`.
- With no enabled channel nothing is marked, so adding one later still
  reminds; if every channel fails, the next tick tries again.
- Before migration 0121 a home roast queued a one-off `rest-done` job; any
  still waiting are skipped.

## Low green stock

- **Preference:** `greenStockAlerts` (boolean, default `true`).
- **Queuing:** when saving or editing a roast takes a green coffee from at
  or above its `lowStockGrams` to below it, a job (`green-low`, data
  `{ greenCoffeeId, userId }`, no delay) goes to whoever saved it, with
  `greenStockAlerts` on and an enabled channel. Once below, further roasts
  don't send it again until it's restocked and crosses again. It never
  fails the save.
- **Sending:** skipped if the green coffee was deleted, is no longer low
  (restocked), or the alerts were turned off. Otherwise:
  - title "Green coffee running low" ("Green coffee used up" at 0 g);
  - message "Ethiopia Guji · 80 g left" ("… · none left");
  - link `<APP_URL>/roast/green`.
- **In the app:** the Green tab marks it Low or None left, and the roast's
  page says so too (§4f).

## Recaps

Weekly and monthly recaps (recaps.md §11c).

- **Preferences:** `recaps` and `recapNotify` (both default `true`),
  `recapPeriods`, `weekStartsOn`, `recapNotifyTime` (default `"08:00"`) and
  `timeZone` (auth.md §1).
- **Scheduling:** a BullMQ job scheduler on the reminder queue
  (`recap-tick`, cron `*/15 * * * *`), set when the backend starts. Each
  tick (`worker/src/recaps.ts`) finds the people with both preferences on
  whose local time (their `timeZone`, else the workspace's `timeZone`
  (§2), else `BREW_TIMEZONE`, else UTC; a person's workspaces in different
  zones are checked in each) has
  reached `recapNotifyTime` on the **first day** of a new week or month, for
  each kind in `recapPeriods`.
- **What's sent:** for the period just ended, one notification per
  workspace the person brewed in (and still belongs to); none for a period
  without their brews. A brew's day is its local date, as Insights counts
  it (§11).
  - title "Your week in coffee" / "Your month in coffee";
  - message "2–8 Nov · 12 brews · avg 3.9 · best 4.5, Kenya Nyeri on the
    V60" (the coffee rating; the best is the newest of the top rated),
    starting with the workspace's name when more than one is sent;
  - link `<APP_URL>/insights/recap?kind=weekly&start=2026-11-02&ws=<id>`,
    which switches to that workspace.
- **AI summary first:** with `recapAi` `auto` and AI in the workspace, the
  summary (llm-contract.md §9f) is written on the row before sending, once
  per row; a failure is recorded there and doesn't stop the notification.
- **Once only:** a `recaps` row (scope `mine`) claims each send through its
  `notified_at`. A send that fails on every channel, or finds no enabled
  channel, gives the claim back, so a later tick that day tries again. Only
  that day: after a server outage covering it, the banner and Insights →
  Recap still have the recap, but no notification comes.
