# 1. Authentication (JWT in httpOnly Cookie)

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The session is a signed JWT (`HS256`, secret from `process.env.JWT_SECRET`)
with payload `{ "sub": "<userId>", "sv": <sessionVersion> }` and a 7-day
expiry. It is stored in a
cookie named `session` with `HttpOnly`, `SameSite=Lax`, `Path=/`, and
`Secure` when `NODE_ENV=production`. The frontend must send requests with
`credentials: "include"`. CORS allows only `process.env.CORS_ORIGIN` with
credentials enabled.

Passwords are hashed with `scrypt` (Node `crypto`, random 16-byte salt) and
compared in constant time.

**Session invalidation:** every authenticated request compares the token's
`sv` with `users.session_version`. Changing the password increments it, so all
older sessions get `401` on their next request (the device that changed it is
issued a new cookie). A token for a deleted account also gets `401`. In both
cases the response clears the cookie.

**`401` vs `403`:** `401` always means "not logged in" (the frontend should send
the user to the login screen). A wrong *current* password in the endpoints
below is `403`, so a typo doesn't look like a logout.

## `POST /api/auth/register`

- **Auth Required:** `false`
- **Body:** `{ "email": "a@b.com", "password": "min 8 chars" }`
- **Success (`201 Created`):** sets the `session` cookie and returns
  `{ "user": { "id": "uuid", "email": "a@b.com", "preferences": { ... }, "isAdmin": false } }`
  (`isAdmin`: a server admin, granted on the server; §10)
- **Errors:** `400` invalid body; `403` registration is closed
  (`ALLOW_REGISTRATION=false`); `409` email already registered.

## `GET /api/auth/registration`

- **Auth Required:** `false`
- **Success (`200 OK`):** `{ "open": true }`: whether this server takes new
  accounts. `ALLOW_REGISTRATION=false` closes it (e.g. a server open to the
  internet; §10); existing accounts still log in. The app hides "Create an
  account" when it's closed.

## `POST /api/auth/login`

- **Auth Required:** `false`
- **Body:** `{ "email": "a@b.com", "password": "..." }`
- **Success (`200 OK`):** sets the `session` cookie and returns
  `{ "user": { "id": "uuid", "email": "a@b.com", "preferences": { ... }, "isAdmin": false } }`
- **Errors:** `400` invalid body; `401` wrong email or password. The message is
  the same for both so it doesn't reveal which emails are registered.
- **Rate limit:** 10 failed attempts per IP per 15 minutes; successful logins
  don't count. Further attempts get `429 Too Many Requests` with a
  `Retry-After` header (seconds) and `{ "error": "Too many login attempts. Try again later." }`.
  Counters are in-memory, so they reset when the backend restarts.

## `POST /api/auth/logout`

- **Auth Required:** `false`
- **Success (`204 No Content`):** clears the `session` cookie.

## `GET /api/auth/me`

- **Auth Required:** `true`
- **Success (`200 OK`):** `{ "user": { "id": "uuid", "email": "a@b.com", "preferences": { ... }, "isAdmin": false } }`

## Preferences

Every `user` in a response carries `preferences`: the person's display
units, with defaults filled in. Storage is always grams, °C and metres;
clients convert what they show and what's typed (roadmap: Units and defaults).

```json
{ "volumeUnit": "fl_oz", "showBothVolumes": false, "altitudeUnit": "m", "temperatureUnit": "c", "theme": "system", "rateReminders": true, "rateReminderMinutes": 15, "rateLaterDefault": false, "repeatKeeps": ["size", "doseWater", "temp", "grinder", "grind", "waterProfile"] }
```

- `volumeUnit`: `fl_oz` | `ml`: the brew page's yield estimate, and a new
  drink's default size unit.
- `showBothVolumes`: also show the other volume unit.
- `altitudeUnit`: `m` | `ft`.
- `temperatureUnit`: `c` | `f`.
- `theme`: `system` | `light` | `dark`. `system` follows the device's
  setting; the client also remembers the choice per device so it applies
  before the app loads.
- `rateReminders` (default `true`), `rateReminderMinutes` (5–240, default
  `15`) and `rateLaterDefault` (default `false`): rate-later reminders, see
  §1b.
- `steepReminders` (default `true`): remind when a cold brew's steep window
  opens (§1b).
- `repeatKeeps`: what repeating a brew copies (Settings → Repeat brews), a
  list of `REPEAT_KEEPS`, each once:
  - `size`: the drink size;
  - `doseWater`: dose and water;
  - `temp`;
  - `grinder`;
  - `grind`: the setting and RPM, on the same grinder;
  - `waterProfile`;
  - `dilution`: the dilution served (cold styles); a long brew's `steepTemp`
    goes with `temp`;
  - `window`: the window the brew aimed for (cold styles: a long brew's
    steep window, rapid cold's target finish, brew-logs.md §6);
  - `prepTools`: ticks the tools that brew used;
  - `grinderWeights`;
  - `notes`: shown on the log form as a reminder, not copied.

  Default: the first eight. A `PATCH` sends the whole list. The bean and what
  → brewer → recipe always come along; results and ratings never do.

  **Parity rule:** the options follow the brew form. Every brew parameter
  (each `brew.*` field in the field registry, `frontend/src/lib/fields.ts`)
  is listed in `REPEAT_FOR_FIELD` (`frontend/src/lib/repeatBrew.ts`):
  - either with the `repeatKeeps` option that copies it;
  - or as `'result'`, measured each time and never copied (yield, TDS,
    first drop).

  A new brew parameter gets one or the other when it's added. A new option
  goes into `REPEAT_KEEPS` (shared schema and validation), `REPEAT_OPTIONS`
  and `applyRepeat`, and into the default only if repeating should copy it
  out of the box. The TypeScript type and `repeatBrew.test.ts` fail until
  it's done.

### `PATCH /api/auth/me/preferences`

- **Auth Required:** `true`
- **Body:** any non-empty subset of the keys above; unknown keys are `400`.
  Merged into what's stored.
- **Success (`200 OK`):** `{ "preferences": { ...all of them } }`
- **Errors:** `400` invalid, empty or unknown keys.

## `POST /api/auth/password`

Changes the caller's password and logs out all their **other** sessions.

- **Auth Required:** `true`
- **Body:** `{ "currentPassword": "...", "newPassword": "min 8 chars" }`
- **Success (`204 No Content`):** sets a fresh `session` cookie for this device.
- **Errors:** `400` invalid body, or `newPassword` equals `currentPassword`;
  `403` `currentPassword` is wrong; `429` too many wrong attempts (same limit
  and response as login).

## `DELETE /api/auth/me`

Deletes the caller's account. Their workspace memberships are removed. Their
brew logs are **kept** as shared workspace history with `userId: null` and
`brewer: null` (§6).

- **Auth Required:** `true`
- **Body:** `{ "password": "..." }` (re-entered, so an unattended logged-in
  device can't delete the account)
- **Success (`204 No Content`):** clears the `session` cookie.
- **Errors:** `400` invalid body; `403` wrong password; `429` too many wrong
  attempts; `409` the caller is the only owner of one or more workspaces, with
  body `{ "error": "...", "workspaces": [ { "id", "name", "slug" } ] }`.
  Nothing is deleted. They must promote another owner (§2 Members) or delete
  those workspaces first.
