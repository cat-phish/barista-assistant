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
free text. Each method has a **kind**, one of `METHOD_KINDS`:

| `kind` | Examples | Recipe fields (§5) |
|---|---|---|
| `pour_over` | V60, Kalita, Chemex | dose + water, estimated yield, steps with pours |
| `immersion` | AeroPress, French press | same as `pour_over` for now |
| `espresso` | Espresso | dose + target yield (no water), shot time and first-drop windows |

New workspaces get V60 (`pour_over`), Espresso (`espresso`), Aeropress
(`immersion`) and Latte (`espresso`, until drinks replace it).

### `GET /api/workspaces/:workspaceId/brew-methods`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):**
  ```json
  { "brewMethods": [ { "id": "uuid", "name": "V60", "kind": "pour_over" } ] }
  ```
  Sorted by `name`.

### `POST /api/workspaces/:workspaceId/brew-methods`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Chemex", "kind": "pour_over" }` (`name` trimmed,
  1–100 chars; `kind` optional, default `pour_over`)
- **Success (`201 Created`):** `{ "brewMethod": { "id": "uuid", "name": "Chemex", "kind": "pour_over" } }`
- **Errors:** `400` invalid body; `403` viewer; `409` a method with that name
  already exists in this workspace (case-insensitive).

### `PATCH /api/workspaces/:workspaceId/brew-methods/:methodId`

Renames a brew method or changes its kind. Recipes reference it by ID, so
they show the new name immediately (including on the public menu).

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Hario V60" }` and/or `{ "kind": "pour_over" }`
  (at least one; same rules as `POST`)
- **Success (`200 OK`):** `{ "brewMethod": { "id": "uuid", "name": "Hario V60", "kind": "pour_over" } }`
- **Errors:** `400` invalid or empty body; `403` viewer; `404` method not in
  this workspace; `409` another method in this workspace already has that name
  (case-insensitive), or the kind would change while recipes use the method
  (recipe fields differ by kind), with body `{ "error": "...", "recipeCount": 2 }`.
  Changing only the case, e.g. `v60` to `V60`, is allowed.

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

```json
{
  "id": "uuid",
  "name": "Comandante C40",
  "notes": "Red Clix",
  "adjustment": "stepped",
  "settingMin": 0,
  "settingMax": 40,
  "stepSize": 1,
  "burrType": "conical",
  "burrSizeMm": 39,
  "power": "manual",
  "retiredAt": null
}
```

Everything after `name` is optional (`null` when unknown):

| Field | Values |
|---|---|
| `notes` | text, ≤ 255 chars, blank becomes `null` |
| `adjustment` | `stepped` (clicks/detents) or `stepless` (`GRINDER_ADJUSTMENTS`) |
| `settingMin`, `settingMax` | the dial's range, numbers 0–9999 with ≤ 2 decimals; both or neither, min < max |
| `stepSize` | one step/click on the dial, > 0, < 1000, ≤ 2 decimals |
| `burrType` | `conical` or `flat` (`BURR_TYPES`) |
| `burrSizeMm` | integer 10–200 |
| `power` | `manual` or `electric` (`GRINDER_POWER`) |

The range and step size are sent to the AI analysis so its reasoning can talk
in steps ("2 clicks finer"); the rest is reference.

A **retired** grinder (`retiredAt` set) is hidden from pickers for new brews,
but past brews keep showing it, and it can be restored. A grinder that brews
were logged with can't be deleted (retire it instead); an unused one can.

### `GET /api/workspaces/:workspaceId/grinders`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "grinders": [ { ...grinder } ] }`: active ones
  first, then retired; each sorted by `name`.

### `POST /api/workspaces/:workspaceId/grinders`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Comandante C40", ...details }` (`name` trimmed,
  1–100 chars; the details from the table above, all optional and nullable)
- **Success (`201 Created`):** `{ "grinder": { ...grinder } }`
- **Errors:** `400` invalid body; `403` viewer; `409` a grinder with that name
  already exists in this workspace (case-insensitive).

### `PATCH /api/workspaces/:workspaceId/grinders/:grinderId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields plus
  `"retired": true | false`. `retired: true` sets `retiredAt` to now
  (unchanged if already retired); `false` restores it. The range is a pair:
  send both ends, or `null` for either to clear both.
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

## 3c. Espresso Machines

Each workspace keeps its own machines. Only espresso brews record one (§6).
Capabilities describe who controls each part of the shot, so the shot timer
can treat a recipe's pre-infusion right on any machine (docs/roadmap.md
phase 2c) and the AI knows what can be adjusted.

**Machine object:**

```json
{
  "id": "uuid",
  "name": "Linea Mini",
  "notes": null,
  "preinfusion": "manual",
  "flowControl": "manual",
  "pressureControl": "none",
  "retiredAt": null
}
```

| Field | Values (default `none`) |
|---|---|
| `preinfusion` | `none`, `automatic` (the machine does it), `manual` (paddle, lever or button) — `PREINFUSION_MODES` |
| `flowControl`, `pressureControl` | `none`, `manual` (paddle, lever, needle valve), `programmable` (profiles) — `PROFILE_CONTROLS` |

Retiring and deleting work like grinders (§3b): retired machines leave the
pickers but past brews keep showing them; a machine brews were logged with
can't be deleted.

### `GET /api/workspaces/:workspaceId/machines`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "machines": [ { ...machine } ] }`: active first,
  then retired; each sorted by `name`.

### `POST /api/workspaces/:workspaceId/machines`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Linea Mini", "notes": null, "preinfusion": "manual", "flowControl": "manual", "pressureControl": "none" }`
  (`name` trimmed, 1–100 chars; the rest optional: `notes` ≤ 255, blank
  becomes `null`; capabilities default to `none`)
- **Success (`201 Created`):** `{ "machine": { ...machine } }`
- **Errors:** `400`; `403` viewer; `409` a machine with that name already
  exists in this workspace (case-insensitive).

### `PATCH /api/workspaces/:workspaceId/machines/:machineId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields plus `"retired": true | false`
  (as for grinders).
- **Success (`200 OK`):** `{ "machine": { ...machine } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

### `DELETE /api/workspaces/:workspaceId/machines/:machineId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` brews were
  logged with it, with body `{ "error": "...", "brewLogCount": 12 }`. Retire
  it instead.

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
    "roastLevel": "light",
    "roastDate": "2026-10-01",
    "inventoryWeightGrams": 250,
    "showOnPublicMenu": true
  }
  ```
  `roasterName` and `beanName` are required (trimmed, 1–255 chars).
  `process` (≤100 chars), `roastLevel` (one of `ROAST_LEVELS`: `light`,
  `medium_light`, `medium`, `medium_dark`, `dark`) and `roastDate` (ISO date
  or datetime) are optional and nullable. `inventoryWeightGrams` is an integer ≥ 0 (default `0`).
  `showOnPublicMenu` defaults to `true`.
- **Success (`201 Created`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid body; `403` viewer.

### `PATCH /api/workspaces/:workspaceId/beans/:beanId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields, with the same rules.
  Unknown fields are rejected. `process`, `roastLevel` and `roastDate` can be
  set to `null`.
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

A recipe describes how to brew: `targetDoseGrams` of coffee and
`targetWaterGrams` of water (the **coffee:water ratio** is dose:water, e.g.
15 g : 250 g = 1:16.7, calculated by clients), plus an optional estimate of
the beverage yield, an optional **target finish window** for the total brew
time, and an optional water temperature.

**By method kind** (§3), checked against the recipe as it is after the
request (so a `PATCH` that changes `methodId` must also send the fields the
new kind needs):

| | `pour_over` / `immersion` | `espresso` |
|---|---|---|
| `targetWaterGrams` | required | must be absent/`null` |
| `expectedYieldGrams` | optional estimate | **required**: target shot weight; ratio is dose:yield (18 g → 36 g = 1:2) |
| finish window | total brew time | total shot time |
| `firstDropMinSec`/`MaxSec` | must be absent/`null` | optional window (pair, ±3 s default) |
| steps | any | no `bloom`/`pour` steps and no `targetWaterGrams` |

Recipes are grinder-neutral: instead of one grind setting they carry
**approximate starting points per grinder** (`grindSettings`). The brew flow
uses one only when there's no actual setting from your last brew with that
grinder and recipe (§3b `last-setting`).

**Steps** are what the timer runs (`docs/timer_architecture.md` §3). Each has a
`stepType`, an optional `label` (e.g. "Second bloom"), and a start and end time
in seconds from the start of the brew. Gaps between steps are waiting time.
Water steps (`bloom`, `pour`) carry `targetWaterGrams`: the cumulative scale
weight to **pour to** by the step's end (clients show the per-step amount, the
difference from the previous water step, next to it).

| `stepType` | Meaning | `targetWaterGrams` |
|---|---|---|
| `bloom` | Pour to wet the grounds and let them degas (repeatable for double blooms) | required |
| `pour` | Pour | required |
| `swirl` | Swirl the brewer | must be absent/`null` |
| `stir` | Stir the slurry | must be absent/`null` |
| `wait` | Wait / drawdown | must be absent/`null` |
| `press` | Press / plunge (AeroPress, French press) | must be absent/`null` |
| `other` | Anything else; give it a `label` | optional |

**Recipe object** (every endpoint below returns this shape):

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "name": "House V60",
  "method": { "id": "uuid", "name": "V60", "kind": "pour_over" },
  "targetDoseGrams": 15,
  "targetWaterGrams": 250,
  "expectedYieldGrams": 220,
  "expectedFinishMinSec": 165,
  "expectedFinishMaxSec": 195,
  "firstDropMinSec": null,
  "firstDropMaxSec": null,
  "targetTempC": 94,
  "showOnPublicMenu": true,
  "grindSettings": [
    { "grinderId": "uuid", "grinderName": "Comandante C40", "setting": "20" }
  ],
  "steps": [
    { "id": "uuid", "stepOrder": 1, "stepType": "bloom", "label": null, "startSec": 0, "endSec": 10, "targetWaterGrams": 45 },
    { "id": "uuid", "stepOrder": 2, "stepType": "swirl", "label": null, "startSec": 10, "endSec": 15, "targetWaterGrams": null },
    { "id": "uuid", "stepOrder": 3, "stepType": "pour", "label": "Main pour", "startSec": 45, "endSec": 90, "targetWaterGrams": 250 }
  ]
}
```

`grindSettings` are sorted by grinder name and include retired grinders.
`steps` are in `stepOrder` and may be empty.

### `GET /api/workspaces/:workspaceId/recipes`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "recipes": [ { ...recipe } ] }`, sorted by `name`.

### `POST /api/workspaces/:workspaceId/recipes`

Creates a recipe, its grind starting points and its steps in one transaction.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:**
  ```json
  {
    "name": "House V60",
    "methodId": "uuid",
    "targetDoseGrams": 15,
    "targetWaterGrams": 250,
    "expectedYieldGrams": 220,
    "expectedFinishMinSec": 165,
    "expectedFinishMaxSec": 195,
    "targetTempC": 94,
    "showOnPublicMenu": true,
    "grindSettings": [{ "grinderId": "uuid", "setting": "20" }],
    "steps": [
      { "stepType": "bloom", "startSec": 0, "endSec": 10, "targetWaterGrams": 45 },
      { "stepType": "swirl", "startSec": 10, "endSec": 15 },
      { "stepType": "pour", "label": "Main pour", "startSec": 45, "endSec": 90, "targetWaterGrams": 250 }
    ]
  }
  ```
  - Required: `name`, `methodId` (a brew method in **this** workspace),
    `targetDoseGrams` (> 0, < 1000, max 2 decimals), and by kind (table
    above) `targetWaterGrams` or `expectedYieldGrams` (> 0, < 10000, max 2
    decimals).
  - Optional, nullable: `expectedYieldGrams` for pour-over/immersion (same
    rules as water), `targetTempC` (0–100, max 1 decimal). `showOnPublicMenu`
    defaults to `true`.
  - First-drop window (espresso only): `firstDropMinSec`/`firstDropMaxSec`,
    same pair rules as the finish window below but with a **±3 s** default.
  - Target finish window: `expectedFinishMinSec` and `expectedFinishMaxSec`
    (integers 0–86400, optional, nullable, min ≤ max). If only one is given,
    the other defaults to it **±15 s**: min 165 → max 180; max 195 → min 180
    (never below 0). So a stored window always has both ends, or neither.
  - `grindSettings` (default `[]`): each `grinderId` must be a grinder in this
    workspace (retired allowed), at most once; `setting` trimmed, 1–100 chars.
  - `steps` (default `[]`, max 20), in order (`stepOrder` = array position):
    - `stepType` from the table above; `label` optional, ≤ 255 chars, blank
      becomes `null`.
    - `startSec` and `endSec` are integers 0–86400 with `startSec ≤ endSec`
      (equal is fine for an instant action), and steps don't overlap: each
      starts at or after the previous one's `endSec`.
    - `targetWaterGrams` as in the table (> 0, < 10000, max 2 decimals). Across
      the steps that have one, it never decreases.
  - Not enforced (clients warn instead): the last pour reaching
    `targetWaterGrams`, and the finish window ending after the last step.
- **Success (`201 Created`):** `{ "recipe": { ...recipe } }`
- **Errors:** `400` invalid body, or `methodId`/`grinderId` not in this
  workspace; `403` viewer.

### `PATCH /api/workspaces/:workspaceId/recipes/:recipeId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields, with the same rules.
  Unknown fields are rejected. The optional fields can be set to `null`.
  The finish and first-drop windows are each treated as a pair: sending only
  one end applies the default spread to the other; setting one end to `null`
  clears both. The kind rules apply to the recipe as it is after the change.
  `steps` and `grindSettings`, if present, each **replace** their whole list
  (`[]` clears it); if absent, they're unchanged.
- **Success (`200 OK`):** `{ "recipe": { ...recipe } }`
- **Errors:** `400` invalid or empty body, or `methodId`/`grinderId` not in
  this workspace; `403` viewer; `404` recipe not in this workspace.

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
  "actualWaterGrams": 250,
  "actualYieldGrams": 225,
  "actualTempC": 93,
  "grinderId": "uuid",
  "actualGrindSetting": "18 clicks",
  "actualTimeSec": 150,
  "rating": 3,
  "tastingNotes": "Sour, thin body",
  "bean": { "id": "uuid", "roasterName": "Onyx Coffee Lab", "beanName": "Southern Weather" },
  "recipe": { "id": "uuid", "name": "House V60", "expectedYieldGrams": 220, "methodKind": "pour_over" },
  "grinder": { "id": "uuid", "name": "Comandante C40" },
  "machine": null,
  "brewer": { "id": "uuid", "email": "barista@example.com" }
}
```

`recipe` is `null` when `recipeId` is `null` (no recipe used, or the recipe was
deleted later); its `expectedYieldGrams` is the recipe's current estimate (or
target, for espresso), for comparing with the measured `actualYieldGrams`, and
`methodKind` is its method's kind. `grinder` is
`null` when no grinder was recorded; a retired
grinder still appears here. `machine` (`{ "id", "name" }`, retired ones
included) is set only for espresso brews that recorded one. `userId` and `brewer` are `null` when the brewer deleted their
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
    "actualWaterGrams": 250,
    "actualYieldGrams": 225,
    "actualTempC": 93,
    "grinderId": "uuid",
    "machineId": null,
    "actualGrindSetting": "18 clicks",
    "actualTimeSec": 150,
    "rating": 3,
    "tastingNotes": "Sour, thin body"
  }
  ```
  - Required: `beanId`, `actualDoseGrams`, `actualTimeSec`, and
    `actualWaterGrams`, except for **espresso**: when `recipeId` is an
    espresso recipe, `actualWaterGrams` must be absent/`null` and
    `actualYieldGrams` (the shot weight) is required.
  - `machineId` (optional, nullable; a machine in this workspace, retired
    accepted) only for espresso brews: with any other recipe, or none, it
    must be absent/`null`.
  - `beanId`, plus `recipeId` and `grinderId` (both optional, nullable), must belong
    to **this** workspace. A retired grinder is accepted (e.g. when logging an
    old brew afterwards); clients just don't offer it for new brews.
  - `timestamp` is optional (default: now). Backdating is allowed so a brew
    can be logged afterwards, but it can't be more than 5 minutes in the
    future (allowing for clock skew).
  - Grams and °C follow the recipe rules in §5 (`actualDoseGrams` 0–1000,
    `actualWaterGrams` 0–10000, both > 0, max 2 decimals; `actualTempC` 0–100,
    max 1 decimal, nullable).
  - `actualYieldGrams` is the **measured** beverage weight: optional,
    nullable, same rules as water. Unlike the recipe's rough
    `expectedYieldGrams`, it's a measurement (with a TDS reading it will give
    extraction yield), and clients show it against the recipe's expected yield.
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
  Unknown fields are rejected. The espresso rule is checked against the log
  (and the machine rule) are checked against the log as it is after the
  change, but only when the request sends `recipeId`, `actualWaterGrams`,
  `actualYieldGrams` or `machineId` (so editing the notes of an old log
  whose recipe later moved to another method still works).
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
        "targetWaterGrams": 250
      }
    ]
  }
  ```
  `targetWaterGrams` is `null` for espresso recipes.
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
   - The bean includes its `roastLevel` (or `null` if unknown), which
     matters for temperature advice.
   - The prompt includes the bean's **effective** roast age in days at brew
     time (`roastAgeDays`, excluding days frozen; see §4) and
     `daysFrozenBeforeBrew`, when the bean has a `roastDate`.
   - Each brew includes its `grinder` (or `null`): name plus whatever details
     are recorded (adjustment, setting range, step size, burr type/size,
     power), so the LLM knows which grinder a grind setting refers to, doesn't
     compare settings across different grinders, and can talk in steps.
   - Espresso brews include their `machine` (or `null`): name and
     capabilities (pre-infusion, flow and pressure control).
   - Each brew includes its recipe's `methodKind` (or `null` without a
     recipe), `actualWaterGrams` (`null` for espresso), the measured
     `actualYieldGrams` (or `null`) and `brewRatio`: water ÷ dose, or for
     espresso yield ÷ dose. The recipe includes its method kind, water,
     expected yield (the target for espresso), finish window
     (`expectedFinishMinSec`/`MaxSec`), first-drop window (espresso), and
     its steps with type, label, start/end and pour-to targets.
2. It calls the LLM API using **Structured Outputs** (strict JSON schema mode).

**System Prompt:**

> "You are an expert specialty coffee roaster and barista. Analyze the provided
> extraction log and historical brews for this coffee bean, including roast
> level, roast age, dose, yield, total brew time, rating, and tasting notes. Suggest
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
