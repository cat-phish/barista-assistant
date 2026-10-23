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
  `{ "user": { "id": "uuid", "email": "a@b.com", "preferences": { ... } } }`
- **Errors:** `400` invalid body; `409` email already registered.

## `POST /api/auth/login`

- **Auth Required:** `false`
- **Body:** `{ "email": "a@b.com", "password": "..." }`
- **Success (`200 OK`):** sets the `session` cookie and returns
  `{ "user": { "id": "uuid", "email": "a@b.com", "preferences": { ... } } }`
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
- **Success (`200 OK`):** `{ "user": { "id": "uuid", "email": "a@b.com", "preferences": { ... } } }`

## Preferences

Every `user` in a response carries `preferences`: the person's display
units, with defaults filled in. Storage is always grams, °C and metres;
clients convert what they show and what's typed (roadmap: Units and defaults).

```json
{ "volumeUnit": "fl_oz", "showBothVolumes": false, "altitudeUnit": "m", "temperatureUnit": "c", "theme": "system" }
```

- `volumeUnit`: `fl_oz` | `ml`: the brew page's yield estimate, and a new
  drink's default size unit.
- `showBothVolumes`: also show the other volume unit.
- `altitudeUnit`: `m` | `ft`.
- `temperatureUnit`: `c` | `f`.
- `theme`: `system` | `light` | `dark`. `system` follows the device's
  setting; the client also remembers the choice per device so it applies
  before the app loads.

### `PATCH /api/auth/me/preferences`

- **Auth Required:** `true`
- **Body:** any non-empty subset of the keys above; unknown keys are `400`.
  Merged into what's stored.
- **Success (`200 OK`):** `{ "preferences": { ...all four } }`
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
