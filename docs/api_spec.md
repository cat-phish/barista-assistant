# API & Worker Specification

## 0. Conventions

- All routes are prefixed with `/api` and exchange JSON.
- Error responses use the shape `{ "error": "Human-readable message" }`.
- **Authorization:** routes marked `Auth Required: true` return `401` without a
  valid session. If the user is not a member of the target workspace, the API
  returns `404` (not `403`) so workspace and resource existence is not leaked.
  A member whose role lacks permission gets `403`.
- **Roles:** `owner` and `barista` can write; `viewer` is read-only.
- Decimal columns (grams, °C) are sent and returned as JSON **numbers**
  (e.g. `15`, `18.5`, `94`). Trailing zeros are not preserved, so the frontend
  formats for display (e.g. `toFixed(1)`). The database stores them as exact
  `DECIMAL`s, and the API rejects input with more decimal places than the
  column holds instead of rounding it.
- Error responses may include extra fields alongside `error` where noted
  (e.g. `brewLogCount`).

---

## 1. Authentication (JWT in httpOnly Cookie)

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

### `POST /api/auth/register`

- **Auth Required:** `false`
- **Body:** `{ "email": "a@b.com", "password": "min 8 chars" }`
- **Success (`201 Created`):** sets the `session` cookie and returns
  `{ "user": { "id": "uuid", "email": "a@b.com" } }`
- **Errors:** `400` invalid body; `409` email already registered.

### `POST /api/auth/login`

- **Auth Required:** `false`
- **Body:** `{ "email": "a@b.com", "password": "..." }`
- **Success (`200 OK`):** sets the `session` cookie and returns
  `{ "user": { "id": "uuid", "email": "a@b.com" } }`
- **Errors:** `400` invalid body; `401` wrong email or password. The message is
  the same for both so it doesn't reveal which emails are registered.
- **Rate limit:** 10 failed attempts per IP per 15 minutes; successful logins
  don't count. Further attempts get `429 Too Many Requests` with a
  `Retry-After` header (seconds) and `{ "error": "Too many login attempts. Try again later." }`.
  Counters are in-memory, so they reset when the backend restarts.

### `POST /api/auth/logout`

- **Auth Required:** `false`
- **Success (`204 No Content`):** clears the `session` cookie.

### `GET /api/auth/me`

- **Auth Required:** `true`
- **Success (`200 OK`):** `{ "user": { "id": "uuid", "email": "a@b.com" } }`

### `POST /api/auth/password`

Changes the caller's password and logs out all their **other** sessions.

- **Auth Required:** `true`
- **Body:** `{ "currentPassword": "...", "newPassword": "min 8 chars" }`
- **Success (`204 No Content`):** sets a fresh `session` cookie for this device.
- **Errors:** `400` invalid body, or `newPassword` equals `currentPassword`;
  `403` `currentPassword` is wrong; `429` too many wrong attempts (same limit
  and response as login).

### `DELETE /api/auth/me`

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

---

## 2. Workspaces

### `POST /api/workspaces`

Creates a workspace, adds the caller as `owner`, and seeds the default brew
methods (`DEFAULT_BREW_METHODS` in `docs/schema.md`) in one transaction.

- **Auth Required:** `true`
- **Body:** `{ "name": "Jordan's Coffee Bar", "slug": "jordans-coffee-bar" }`
  (slug: lowercase letters, digits and hyphens, 3–64 chars)
- **Success (`201 Created`):**
  ```json
  {
    "workspace": {
      "id": "uuid",
      "name": "Jordan's Coffee Bar",
      "slug": "jordans-coffee-bar",
      "isPublicMenuEnabled": false,
      "createdAt": "2026-10-18T00:00:00.000Z"
    }
  }
  ```
- **Errors:** `400` invalid body; `409` slug already taken.

### `GET /api/workspaces`

- **Auth Required:** `true`
- **Success (`200 OK`):** `{ "workspaces": [ { ...workspace, "role": "owner" } ] }`
  (only workspaces the caller belongs to)

### `PATCH /api/workspaces/:workspaceId`

Updates workspace settings, including turning the public menu on or off.

- **Auth Required:** `true` (role `owner`)
- **Body:** any non-empty subset of
  `{ "name": "New Name", "isPublicMenuEnabled": true }`
- **Success (`200 OK`):** `{ "workspace": { ...workspace } }`
- **Errors:** `400` invalid or empty body; `403` not an owner.

### `DELETE /api/workspaces/:workspaceId?confirm=<slug>`

Permanently deletes the workspace and everything in it: members, brew methods,
beans, recipes, brew logs and analyses.

- **Auth Required:** `true` (role `owner`)
- **Query:** `confirm` must equal the workspace's `slug`.
- **Success (`204 No Content`)**
- **Errors:** `400` `confirm` missing or not equal to the slug; `403` not an
  owner.

> **Frontend requirement:** ask the owner to type the workspace slug (like
> GitHub's "type the repository name") and pass exactly what they typed as
> `confirm`. Never fill it in automatically.

### Members

There is no email delivery, so "inviting" adds an already-registered user
directly by email.

#### `GET /api/workspaces/:workspaceId/members`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):**
  ```json
  { "members": [ { "userId": "uuid", "email": "a@b.com", "role": "owner" } ] }
  ```
  Sorted by email.

#### `POST /api/workspaces/:workspaceId/members`

- **Auth Required:** `true` (role `owner`)
- **Body:** `{ "email": "barista@example.com", "role": "barista" }` (role is
  `owner`, `barista` or `viewer`)
- **Success (`201 Created`):** `{ "member": { "userId": "uuid", "email": "...", "role": "barista" } }`
- **Errors:** `400` invalid body; `403` not an owner; `404` no registered user
  with that email; `409` already a member.

#### `PATCH /api/workspaces/:workspaceId/members/:userId`

- **Auth Required:** `true` (role `owner`)
- **Body:** `{ "role": "viewer" }`
- **Success (`200 OK`):** `{ "member": { "userId": "uuid", "email": "...", "role": "viewer" } }`
- **Errors:** `400` invalid body; `403` not an owner; `404` that user is not a
  member; `409` the change would leave the workspace with no owner.

#### `DELETE /api/workspaces/:workspaceId/members/:userId`

Removes a member. Owners can remove anyone. Any member can remove themselves
(leave the workspace).

- **Auth Required:** `true` (role `owner`, or `:userId` is the caller)
- **Success (`204 No Content`)**
- **Errors:** `403` not an owner and not removing yourself; `404` that user is
  not a member; `409` would leave the workspace with no owner.

---

## 3. Brew Methods

Recipes must select a method from their workspace's list; methods are not
free text.

### `GET /api/workspaces/:workspaceId/brew-methods`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):**
  ```json
  { "brewMethods": [ { "id": "uuid", "name": "V60" } ] }
  ```
  Sorted by `name`.

### `POST /api/workspaces/:workspaceId/brew-methods`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Chemex" }` (trimmed, 1–100 chars)
- **Success (`201 Created`):** `{ "brewMethod": { "id": "uuid", "name": "Chemex" } }`
- **Errors:** `400` invalid body; `403` viewer; `409` a method with that name
  already exists in this workspace (case-insensitive).

### `PATCH /api/workspaces/:workspaceId/brew-methods/:methodId`

Renames a brew method. Recipes reference it by ID, so they show the new name
immediately (including on the public menu).

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Hario V60" }` (trimmed, 1–100 chars)
- **Success (`200 OK`):** `{ "brewMethod": { "id": "uuid", "name": "Hario V60" } }`
- **Errors:** `400` invalid body; `403` viewer; `404` method not in this
  workspace; `409` another method in this workspace already has that name
  (case-insensitive). Changing only the case, e.g. `v60` to `V60`, is allowed.

### `DELETE /api/workspaces/:workspaceId/brew-methods/:methodId`

The database cascades a method's deletion to its recipes, so the API is what
protects them: a method that any recipe still uses can't be deleted.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` method not in this workspace; `409` recipes
  still use it, with body
  `{ "error": "...", "recipeCount": 2 }`. Change those recipes' method or
  delete them first.

---

## 3b. Grinders

Each workspace keeps its own grinders. Brew logs record which grinder was used
(§6), because a grind setting like `"20"` only means something for one
grinder. Recipes are grinder-neutral.

**Grinder object:**
`{ "id": "uuid", "name": "Comandante C40", "notes": "stepped, 0–40 clicks" | null, "retiredAt": null | "2026-10-18T…" }`

A **retired** grinder (`retiredAt` set) is hidden from pickers for new brews,
but past brews keep showing it, and it can be restored. A grinder that brews
were logged with can't be deleted (retire it instead); an unused one can.

### `GET /api/workspaces/:workspaceId/grinders`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "grinders": [ { ...grinder } ] }`: active ones
  first, then retired; each sorted by `name`.

### `POST /api/workspaces/:workspaceId/grinders`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Comandante C40", "notes": "stepped" }` (`name` trimmed,
  1–100 chars; `notes` optional, ≤ 255, blank becomes `null`)
- **Success (`201 Created`):** `{ "grinder": { ...grinder } }`
- **Errors:** `400` invalid body; `403` viewer; `409` a grinder with that name
  already exists in this workspace (case-insensitive).

### `PATCH /api/workspaces/:workspaceId/grinders/:grinderId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of `{ "name", "notes", "retired": true | false }`.
  `retired: true` sets `retiredAt` to now (unchanged if already retired);
  `false` restores it.
- **Success (`200 OK`):** `{ "grinder": { ...grinder } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

### `DELETE /api/workspaces/:workspaceId/grinders/:grinderId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` brews were
  logged with it, with body `{ "error": "...", "brewLogCount": 12 }`. Retire
  it instead.

### `GET /api/workspaces/:workspaceId/grinders/:grinderId/last-setting?recipeId=<id>`

The grind setting of the most recent brew made with this grinder **and** this
recipe. The brew flow uses it to pre-fill the grind when both are chosen.

- **Auth Required:** `true` (any member)
- **Query:** `recipeId` (required).
- **Success (`200 OK`):**
  `{ "lastSetting": { "grindSetting": "20", "timestamp": "…", "brewLogId": "uuid" } | null }`.
  It's the newest such brew that has a grind setting (brews without one are
  skipped), or `null` if there's none.
- **Errors:** `400` missing/invalid `recipeId`; `404` grinder not in this
  workspace.

---

## 4. Beans

### `GET /api/workspaces/:workspaceId/beans`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "beans": [ { ...bean } ] }`, sorted by
  `roasterName`, then `beanName`. Each bean has every column in `beans`, plus
  `freezePeriods` (oldest first):
  ```json
  "freezePeriods": [
    { "id": "uuid", "frozenOn": "2026-10-03", "thawedOn": "2026-10-10" },
    { "id": "uuid", "frozenOn": "2026-10-15", "thawedOn": null }
  ]
  ```
  A bean is frozen when its last period has `thawedOn: null`. Every endpoint
  that returns a bean includes `freezePeriods`.

**Effective roast age** (days), computed by clients and the worker, as of
calendar date `D`:
`(D − roastDate) − Σ days frozen between roastDate and D`, where a period
counts from `frozenOn` up to `thawedOn` (or `D` while still frozen). So the
age stops while frozen and resumes after thawing. Without a `roastDate` there
is no age.

### `POST /api/workspaces/:workspaceId/beans`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:**
  ```json
  {
    "roasterName": "Onyx Coffee Lab",
    "beanName": "Southern Weather",
    "process": "Washed",
    "roastDate": "2026-10-01",
    "inventoryWeightGrams": 250,
    "showOnPublicMenu": true
  }
  ```
  `roasterName` and `beanName` are required (trimmed, 1–255 chars).
  `process` (≤100 chars) and `roastDate` (ISO date or datetime) are optional
  and nullable. `inventoryWeightGrams` is an integer ≥ 0 (default `0`).
  `showOnPublicMenu` defaults to `true`.
- **Success (`201 Created`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid body; `403` viewer.

### `PATCH /api/workspaces/:workspaceId/beans/:beanId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields, with the same rules.
  Unknown fields are rejected. `process` and `roastDate` can be set to `null`.
- **Success (`200 OK`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid or empty body; `403` viewer; `404` bean not in this
  workspace.

### `DELETE /api/workspaces/:workspaceId/beans/:beanId`

The schema cascades a bean's deletion to its `brew_logs` and their
`llm_analyses`, so deleting a bean with history needs explicit confirmation.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Query:** `?deleteBrewLogs=true` confirms that the bean's brew logs (and
  their analyses) should be deleted with it. Without it, a bean that has brew
  logs is not deleted.
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` bean not in this workspace; `409` the bean
  has brew logs and `deleteBrewLogs=true` was not passed, with body
  `{ "error": "...", "brewLogCount": 12 }`.

> **Frontend requirement (confirm before deleting brew history):** call
> `DELETE` without the query first. On `409`, show a confirmation dialog using
> `brewLogCount`, e.g. *"Deleting this bean will also permanently delete its
> 12 brew logs and their AI suggestions. Consider hiding it from the menu or
> setting its inventory to 0 instead."*, with actions **Cancel**, **Hide
> instead** (`PATCH` `showOnPublicMenu: false`) and **Delete everything**
> (retry with `?deleteBrewLogs=true`). Never send `deleteBrewLogs=true`
> without the user confirming that dialog.

### `POST /api/workspaces/:workspaceId/beans/:beanId/freeze`

Starts a freeze period.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "date": "2026-10-15" }` (optional; defaults to the server's
  current date). Clients should send the user's local date.
- **Rules:** the date can't be before the bean's `roastDate`, before the
  previous period's `thawedOn`, or more than one day after the server's
  current date (allowing for time zones).
- **Success (`200 OK`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid date or rule broken; `403` viewer; `404` bean not
  in this workspace; `409` already frozen.

### `POST /api/workspaces/:workspaceId/beans/:beanId/thaw`

Ends the open freeze period.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "date": "2026-10-20" }` (optional, same as freeze)
- **Rules:** the date can't be before that period's `frozenOn`, or more than
  one day after the server's current date.
- **Success (`200 OK`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid date or rule broken; `403` viewer; `404` bean not
  in this workspace; `409` not frozen.

---

## 5. Recipes

A recipe's `method` is returned as `{ "id", "name" }` from its brew method.
`steps` are the timed pour-over intervals used by the timer
(`docs/timer_architecture.md`). They are returned in `stepOrder`, and the list
may be empty (e.g. espresso).

### `GET /api/workspaces/:workspaceId/recipes`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "recipes": [ { ...recipe } ] }`, sorted by
  `name`, each shaped like the `POST` response below.

### `POST /api/workspaces/:workspaceId/recipes`

Creates a recipe and its steps in one transaction.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:**
  ```json
  {
    "name": "House V60",
    "methodId": "uuid",
    "targetDoseGrams": 15,
    "targetYieldGrams": 250,
    "targetTempC": 94,
    "targetGrindSetting": "18 clicks",
    "showOnPublicMenu": true,
    "steps": [
      { "actionName": "Bloom", "targetTimeSec": 45, "targetWaterGrams": 50 },
      { "actionName": "First Pour", "targetTimeSec": 90, "targetWaterGrams": 150 },
      { "actionName": "Second Pour", "targetTimeSec": 135, "targetWaterGrams": 250 }
    ]
  }
  ```
  - `methodId` must be a brew method in **this** workspace.
  - Grams are numbers > 0 with at most 2 decimals (`targetDoseGrams` < 1000,
    others < 10000). `targetTempC` is optional, 0–100, at most 1 decimal.
  - `targetGrindSetting` is optional (≤100 chars). `showOnPublicMenu`
    defaults to `true`. `steps` defaults to `[]`, max 20.
  - `stepOrder` is assigned from array position (1, 2, 3...). Step times and
    water weights are cumulative: `targetTimeSec` must strictly increase and
    `targetWaterGrams` must not decrease from one step to the next.
- **Success (`201 Created`):**
  ```json
  {
    "recipe": {
      "id": "uuid",
      "workspaceId": "uuid",
      "name": "House V60",
      "method": { "id": "uuid", "name": "V60" },
      "targetDoseGrams": 15,
      "targetYieldGrams": 250,
      "targetTempC": 94,
      "targetGrindSetting": "18 clicks",
      "showOnPublicMenu": true,
      "steps": [
        { "id": "uuid", "stepOrder": 1, "actionName": "Bloom", "targetTimeSec": 45, "targetWaterGrams": 50 }
      ]
    }
  }
  ```
- **Errors:** `400` invalid body, or `methodId` not in this workspace;
  `403` viewer.

### `PATCH /api/workspaces/:workspaceId/recipes/:recipeId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields, with the same rules.
  Unknown fields are rejected. `targetTempC` and `targetGrindSetting` can be
  set to `null`. If `steps` is present it **replaces** the whole step list
  (`[]` removes all steps); if absent, steps are unchanged.
- **Success (`200 OK`):** `{ "recipe": { ...recipe } }` (same shape as `POST`)
- **Errors:** `400` invalid or empty body, or `methodId` not in this workspace;
  `403` viewer; `404` recipe not in this workspace.

### `DELETE /api/workspaces/:workspaceId/recipes/:recipeId`

Deletes the recipe and its steps. Brew logs that used it are kept, with
`recipeId` set to `null`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` recipe not in this workspace.

---

## 6. Brew Logs

A brew log records one actual brew: what was used, what happened, and how it
tasted. The pour-over timer's **Finish & Save** creates one. Logs are what the
LLM analysis (§8) and parameter suggestions read.

**Permissions:** any member can read. Owners can create, edit and delete any
log. Baristas can create logs and edit or delete **their own** (`403`
otherwise). Viewers are read-only. The log's `userId` is always the caller who
created it and can't be changed.

**Brew log object** (returned by every endpoint below):

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "userId": "uuid",
  "beanId": "uuid",
  "recipeId": "uuid",
  "timestamp": "2026-10-18T08:55:00.000Z",
  "actualDoseGrams": 15,
  "actualYieldGrams": 250,
  "actualTempC": 93,
  "grinderId": "uuid",
  "actualGrindSetting": "18 clicks",
  "actualTimeSec": 150,
  "rating": 3,
  "tastingNotes": "Sour, thin body",
  "bean": { "id": "uuid", "roasterName": "Onyx Coffee Lab", "beanName": "Southern Weather" },
  "recipe": { "id": "uuid", "name": "House V60" },
  "grinder": { "id": "uuid", "name": "Comandante C40" },
  "brewer": { "id": "uuid", "email": "barista@example.com" }
}
```

`recipe` is `null` when `recipeId` is `null` (no recipe used, or the recipe was
deleted later). `grinder` is `null` when no grinder was recorded; a retired
grinder still appears here. `userId` and `brewer` are `null` when the brewer deleted their
account. Such logs can only be edited or deleted by owners.

### `GET /api/workspaces/:workspaceId/brew-logs`

- **Auth Required:** `true` (any member)
- **Query (all optional):** `beanId`, `recipeId` (filters); `limit` (1–100,
  default 50); `offset` (default 0).
- **Success (`200 OK`):** `{ "brewLogs": [ ...brewLog ], "total": 123 }`, newest
  `timestamp` first. `total` counts all matches, ignoring `limit`/`offset`.
- **Errors:** `400` invalid query.

### `GET /api/workspaces/:workspaceId/brew-logs/:brewLogId`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewLog": { ...brewLog, "latestAnalysis": LlmAnalysis | null } }`,
  where `latestAnalysis` is the newest `llm_analyses` row for this log.
- **Errors:** `404` log not in this workspace.

### `POST /api/workspaces/:workspaceId/brew-logs`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:**
  ```json
  {
    "beanId": "uuid",
    "recipeId": "uuid",
    "timestamp": "2026-10-18T08:55:00.000Z",
    "actualDoseGrams": 15,
    "actualYieldGrams": 250,
    "actualTempC": 93,
    "grinderId": "uuid",
    "actualGrindSetting": "18 clicks",
    "actualTimeSec": 150,
    "rating": 3,
    "tastingNotes": "Sour, thin body"
  }
  ```
  - Required: `beanId`, `actualDoseGrams`, `actualYieldGrams`, `actualTimeSec`.
  - `beanId`, plus `recipeId` and `grinderId` (both optional, nullable), must belong
    to **this** workspace. A retired grinder is accepted (e.g. when logging an
    old brew afterwards); clients just don't offer it for new brews.
  - `timestamp` is optional (default: now). Backdating is allowed so a brew
    can be logged afterwards, but it can't be more than 5 minutes in the
    future (allowing for clock skew).
  - Grams and °C follow the recipe rules in §5 (`actualDoseGrams` 0–1000,
    `actualYieldGrams` 0–10000, both > 0, max 2 decimals; `actualTempC` 0–100,
    max 1 decimal, nullable).
  - `actualTimeSec`: integer 0–86400 (24 hours). `rating`: integer **1–5**,
    nullable. `actualGrindSetting` ≤ 100 chars, `tastingNotes` ≤ 5000 chars;
    both nullable, and blank becomes `null`.
- **Success (`201 Created`):** `{ "brewLog": { ...brewLog } }`
- **Errors:** `400` invalid body, or `beanId`/`recipeId`/`grinderId` not in
  this workspace; `403` viewer.
- Logging a brew does **not** change the bean's `inventoryWeightGrams`.

### `PATCH /api/workspaces/:workspaceId/brew-logs/:brewLogId`

- **Auth Required:** `true` (owner, or the barista who created it)
- **Body:** any non-empty subset of the `POST` fields, with the same rules.
  Unknown fields are rejected.
- **Success (`200 OK`):** `{ "brewLog": { ...brewLog } }`
- **Errors:** `400` invalid or empty body, or `beanId`/`recipeId` not in this
  workspace; `403` viewer, or a barista editing someone else's log; `404` log
  not in this workspace.

### `DELETE /api/workspaces/:workspaceId/brew-logs/:brewLogId`

Deletes the log and its `llm_analyses` (cascade).

- **Auth Required:** `true` (owner, or the barista who created it)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer, or a barista deleting someone else's log; `404` log
  not in this workspace.

---

## 7. Public Menu Endpoint

Retrieves the read-only menu for a workspace. Unauthenticated, but strictly
filters for workspaces where `isPublicMenuEnabled = true` and items where
`showOnPublicMenu = true`. `method` is the name of the recipe's brew method.

- **URL:** `GET /api/public/menu/:slug`
- **Auth Required:** `false`
- **Success Response (`200 OK`):**
  ```json
  {
    "workspace": {
      "name": "Jordan's Coffee Bar",
      "slug": "jordans-coffee-bar"
    },
    "beans": [
      {
        "id": "uuid",
        "roasterName": "Onyx Coffee Lab",
        "beanName": "Southern Weather",
        "process": "Washed",
        "roastDate": "2026-10-01T00:00:00.000Z",
        "inventoryWeightGrams": 250
      }
    ],
    "recipes": [
      {
        "id": "uuid",
        "name": "House V60",
        "method": "V60",
        "targetDoseGrams": 15,
        "targetYieldGrams": 250
      }
    ]
  }
  ```
- **Error Responses:**
  - `404 Not Found`: Workspace slug does not exist or `isPublicMenuEnabled` is
    `false`. Slugs are matched exactly: `/menu/Jordans-Coffee-Bar` is a `404`,
    so each menu has exactly one URL (and one offline cache entry).

---

## 8. LLM Brew Analysis / Parameter Suggestions

### `POST /api/brew-logs/:brewLogId/analyze`

Queues a background BullMQ job in Redis to analyze a brew log and historic
brews for that bean, returning starting parameter suggestions for the next
brew.

- **Auth Required:** `true` (role `owner` or `barista` in the brew log's
  workspace)
- **Success Response (`202 Accepted`):**
  ```json
  {
    "status": "queued",
    "jobId": "bullmq-job-id",
    "message": "Brew analysis queued."
  }
  ```
- **Errors:** `404` brew log not found or not in a workspace the caller
  belongs to (same message, and the same single query, for both, so neither
  body nor timing reveals whether the log exists); `403` viewer; `503` the
  queue (Redis) is unavailable.
- **Duplicates:** while a log's analysis is waiting or running, another
  request returns `202` with the **same** `jobId` and queues nothing new. Once
  that job finishes (or finally fails), the log can be analyzed again, and each
  run adds a new `llm_analyses` row.
- **Getting the result:** there is no job-status endpoint. The frontend polls
  `GET /api/workspaces/:workspaceId/brew-logs/:brewLogId` (§6) until
  `latestAnalysis` is newer than when it requested the analysis (by
  `createdAt`), or uses `GET /api/beans/:beanId/suggestions`.

### `GET /api/beans/:beanId/suggestions`

Fetches the most recent `llm_analyses` record for the given bean, along with
the last 5 `brew_logs` for that bean, so the frontend "Suggest Parameters"
button can pre-fill targets when starting a new brew. `llm_analyses` has no
`beanId`; the latest analysis is found by joining through `brew_logs` and
ordering by `llm_analyses.createdAt` descending.

- **Auth Required:** `true` (any member of the bean's workspace)
- **Success Response (`200 OK`):**
  ```json
  {
    "latestAnalysis": {
      "id": "uuid",
      "brewLogId": "uuid",
      "reasoning": "Under-extracted: sour and thin at 2:30. Grind finer.",
      "suggestedGrindDelta": "finer",
      "suggestedTempDelta": 1,
      "createdAt": "2026-10-18T09:00:00.000Z"
    },
    "analyzedBrew": { ...brewLog },
    "recentBrews": [ { ...brewLog } ]
  }
  ```
  - `latestAnalysis`: the newest analysis of any brew of this bean (by
    `createdAt`), or `null` if none exists yet.
  - `analyzedBrew`: the brew log that `latestAnalysis` analyzed (the §6
    brew log object), or `null` when `latestAnalysis` is `null`. The
    suggested deltas are relative to **this** brew, which may be older than
    the newest brew or outside `recentBrews`. To pre-fill a new brew, start
    from its parameters and apply the deltas.
  - `recentBrews`: the last 5 brew logs for the bean (§6 brew log objects),
    newest first; may be empty.
- **Errors:** `404` bean not found or not in a workspace the caller belongs
  to (same message for both).

---

## 9. Worker -> LLM Structured Output Contract

**Queue contract** (constants in `@barista/shared/jobs`):

- Queue `brew-analysis`, job name `analyze`, data `{ "brewLogId": "uuid" }`.
- Job ID `analyze-<brewLogId>`: this is what makes duplicate requests (§8)
  return the existing job.
- The backend adds jobs with 3 attempts and exponential backoff starting at
  5 s. Completed and failed jobs are removed from Redis. The result lives in
  `llm_analyses`, and failures are logged by the worker.

**Configuration (worker env):** `DATABASE_URL` + `DATABASE_PASSWORD`,
`REDIS_URL` + `REDIS_PASSWORD`, `OPENAI_API_KEY`, and `OPENAI_MODEL`
(required, no default, since valid model names change over time). Passwords
are kept out of the URLs; a URL that also contains a password is rejected.
Each secret can instead be given as `NAME_FILE` (a path, e.g. a Docker secret
under `/run/secrets`), but not both. `OPENAI_BASE_URL` is optional and points
the OpenAI SDK at a compatible server (used for testing). The backend follows
the same rules for its own `DATABASE_*`, `REDIS_*` and `JWT_SECRET`.

When the `/worker` service processes a job from the `brew-analysis` BullMQ
queue:

1. It queries the target `brew_log`, the associated `bean`, the `recipe` (with
   its steps), and up to 5 previous `brew_logs` for that same `beanId`
   ("previous" = `timestamp` earlier than the target's, newest first).
   - If the brew log no longer exists (deleted after queueing), the job
     completes without calling the LLM.
   - The prompt includes the bean's **effective** roast age in days at brew
     time (`roastAgeDays`, excluding days frozen; see §4) and
     `daysFrozenBeforeBrew`, when the bean has a `roastDate`.
   - Each brew includes `grinderName` (or `null`), so the LLM knows which
     grinder a grind setting refers to and doesn't compare settings across
     different grinders.
2. It calls the LLM API using **Structured Outputs** (strict JSON schema mode).

**System Prompt:**

> "You are an expert specialty coffee roaster and barista. Analyze the provided
> extraction log and historical brews for this coffee bean, including roast
> age, dose, yield, total brew time, rating, and tasting notes. Suggest
> concrete parameter adjustments for the next brew. Respond strictly matching
> the provided JSON schema."

**Strict JSON Schema** (sent as-is; no `$schema` key, which strict mode does
not need):

```json
{
  "type": "object",
  "properties": {
    "reasoning": {
      "type": "string",
      "description": "A concise 1-2 sentence diagnosis of extraction quality and why adjustments are needed."
    },
    "suggestedGrindDelta": {
      "type": "string",
      "enum": ["much_finer", "finer", "no_change", "coarser", "much_coarser"]
    },
    "suggestedTempDelta": {
      "type": "number",
      "description": "Suggested change in Celsius (e.g., -1.5, 0, 2.0)."
    }
  },
  "required": ["reasoning", "suggestedGrindDelta", "suggestedTempDelta"],
  "additionalProperties": false
}
```

3. Once parsed, the worker inserts the result into the `llm_analyses` table.
   - The response is validated again after parsing (strict mode should
     guarantee the shape, but the worker doesn't rely on it).
   - `suggestedTempDelta` is rounded to 1 decimal (the column is
     `DECIMAL(3,1)`) and must be between −10 and +10 °C. Anything outside that
     is treated as a bad response: the attempt fails and BullMQ retries it.
   - A refusal, an empty response, or invalid JSON also fails the attempt.
