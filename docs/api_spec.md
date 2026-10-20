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
brewers (`DEFAULT_BREWERS` in `docs/schema.md`) in one transaction.

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

Permanently deletes the workspace and everything in it: members, brewers,
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

## 3. Brewers

What makes the coffee: a V60, a Chemex, an AeroPress, an espresso machine.
Recipes and drinks (§5, §5c) belong to a brewer from their workspace's list.
Each brewer has a **kind**, one of `METHOD_KINDS`:

| `kind` | Examples | Recipe fields (§5) |
|---|---|---|
| `pour_over` | V60, Kalita, Chemex | dose + water, estimated yield, steps with pours |
| `immersion` | AeroPress, French press | same as `pour_over` for now |
| `espresso` | Linea Mini, Gaggia Classic | dose + target yield (no water), shot time and first-drop windows |

New workspaces get V60 (`pour_over`), Espresso (`espresso`) and Aeropress
(`immersion`). Milk drinks like a latte are drinks (§5c): built on a brewer,
brewed with one of its recipes, plus ingredients.

**Espresso capabilities** describe who controls each part of the shot, so the
shot timer notes what the machine can't do and the AI knows what can be
adjusted. Other kinds keep `none`.

| Field | Values (default `none`) |
|---|---|
| `preinfusion` | `none`, `automatic` (the machine does it), `manual` (paddle, lever or button) — `PREINFUSION_MODES` |
| `flowControl`, `pressureControl` | `none`, `manual` (paddle, lever, needle valve), `programmable` (profiles) — `PROFILE_CONTROLS` |

**Category and menu:** a brewer's optional drink category (§5d) is where it's
listed when brewing (Category → Brewer or drink → Recipe) and on the public
menu (§7), where it can appear as the plain brew under `menuName` (else its
name), e.g. "Espresso" for a Linea Mini.

Retiring works like grinders (§3b): retired brewers leave the pickers, and
past brews keep showing them.

**Brewer object:**

```json
{
  "id": "uuid",
  "name": "Linea Mini",
  "kind": "espresso",
  "notes": "18 g VST basket",
  "preinfusion": "manual",
  "flowControl": "manual",
  "pressureControl": "none",
  "menuName": "Espresso",
  "description": null,
  "categoryId": "uuid",
  "showOnPublicMenu": true,
  "retiredAt": null
}
```

### `GET /api/workspaces/:workspaceId/brewers`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewers": [ { ...brewer } ] }`: active first,
  then retired, each by `name`.

### `POST /api/workspaces/:workspaceId/brewers`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Chemex", "kind": "pour_over" }` (`name` trimmed,
  1–100 chars; `kind` optional, default `pour_over`). Optional: `notes`
  (≤ 255), the capabilities (default `none`), `menuName` (≤ 100),
  `description` (≤ 500), `categoryId` (a drink category in this workspace,
  or `null`), `showOnPublicMenu` (default `false`). Blank text becomes `null`.
- **Success (`201 Created`):** `{ "brewer": { ...brewer } }`
- **Errors:** `400` invalid body or a category not in this workspace; `403`
  viewer; `409` a brewer with that name already exists in this workspace
  (case-insensitive).

### `PATCH /api/workspaces/:workspaceId/brewers/:brewerId`

Recipes and drinks reference it by ID, so a rename shows up everywhere at once.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields (same rules), plus
  `retired` (`true` retires it, keeping the first retirement date; `false`
  restores it).
- **Success (`200 OK`):** `{ "brewer": { ...brewer } }`
- **Errors:** `400` invalid or empty body, or a category not in this
  workspace; `403` viewer; `404` not in this workspace; `409` another brewer
  already has that name (case-insensitive; changing only the case is
  allowed), or the kind would change while recipes use it (recipe fields
  differ by kind), with body `{ "error": "...", "recipeCount": 2 }`.

### `DELETE /api/workspaces/:workspaceId/brewers/:brewerId`

The database cascades a brewer's deletion to its recipes and drinks, so the
API is what protects them, and brew history keeps a brewer once used.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` recipes,
  drinks or brew logs use it, with body
  `{ "error": "...", "recipeCount": 2, "drinkCount": 1, "brewLogCount": 5 }`.
  Move or delete the recipes and drinks first; with only brew logs left,
  retire it instead.

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

**By brewer kind** (§3), checked against the recipe as it is after the
request (so a `PATCH` that changes `brewerId` must also send the fields the
new kind needs):

| | `pour_over` / `immersion` | `espresso` |
|---|---|---|
| `targetWaterGrams` | required | must be absent/`null` |
| `expectedYieldGrams` | optional estimate | **required**: target shot weight; ratio is dose:yield (18 g → 36 g = 1:2) |
| finish window | total brew time | total shot time |
| `firstDropMinSec`/`MaxSec` | must be absent/`null` | optional window (pair, ±3 s default) |
| step types | `bloom` `pour` `swirl` `stir` `wait` `press` `other` | `preinfusion` `soak` `pressure` `flow` `other` (`ESPRESSO_STEP_TYPES`) |
| step `advance` | `auto`, `auto_log`, `tap` | also `first_drop` (at most one step) |
| `flowUnit` | ignored (default `g_s`) | `g_s` or `ml_s` for flow steps |

Recipes are grinder-neutral: instead of one grind setting they carry
**approximate starting points per grinder** (`grindSettings`). The brew flow
uses one only when there's no actual setting from your last brew with that
grinder and recipe (§3b `last-setting`). A recipe can name a
**`defaultGrinderId`**: the grinder the brew flow preselects for it (instead
of the last grinder used), if that grinder isn't retired.

**Steps** are what the timer runs (`docs/timer_architecture.md` §3). They run
**back to back**: each starts when the previous one actually ended, so a step
you end with a tap (a bloom that waits for the kettle) moves everything after
it. Each step has a `stepType`, an optional `label` (e.g. "Second bloom"), a
`durationSec`, how it moves on (`advance`), and instruction values shown on its
card. Waiting is an explicit `wait` (pour over) or `soak` (espresso) step.

| `advance` | The timer… | `durationSec` |
|---|---|---|
| `auto` | moves on when the duration is up | required (0 = instant action, shown ~2 s); `null` only on the last step = until you finish |
| `auto_log` | the same, plus a **Log it** button to record when you really did it | required |
| `tap` | waits for **Next** | optional guide ("tap when ready" once it's passed) |
| `first_drop` | espresso: ends when **First drop** is tapped | optional guide |

| `stepType` | Meaning | Values |
|---|---|---|
| `bloom` | Pour to wet the grounds and let them degas (repeatable for double blooms) | `targetWaterGrams` required |
| `pour` | Pour | `targetWaterGrams` required |
| `swirl` / `stir` | Swirl the brewer / stir the slurry | – |
| `wait` | Wait / drawdown | – |
| `press` | Press / plunge (AeroPress, French press) | – |
| `preinfusion` | Espresso: low-pressure / low-flow fill | pressure **or** flow, optional |
| `soak` | Espresso: pump off | – |
| `pressure` | Espresso: hold or ramp pressure | `pressureBar` required, `pressureEndBar` optional (ramp) |
| `flow` | Espresso: hold or ramp flow | `flowRate` required, `flowEndRate` optional (ramp) |
| `other` | Anything else; give it a `label` | pour-over: `targetWaterGrams` optional; espresso: pressure or flow optional |

- `targetWaterGrams`: the cumulative scale weight to **pour to** by the step's
  end (> 0, < 10000, max 2 decimals; never decreasing across steps). Clients
  show the per-step amount next to it.
- `targetTempC` (any step, optional, 0–100, 1 decimal): e.g. bloom at 85 °C,
  pour at 93 °C.
- `pressureBar`/`pressureEndBar` (0–20 bar, 1 decimal) and
  `flowRate`/`flowEndRate` (0–20 in the recipe's `flowUnit`, 1 decimal): an end
  value needs a start value and makes a ramp ("9 → 6 bar"). They're
  instructions; the timer doesn't measure them. Any value not listed for a
  type must be absent/`null`.

**Recipe object** (every endpoint below returns this shape):

```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "name": "House V60",
  "brewer": { "id": "uuid", "name": "V60", "kind": "pour_over" },
  "targetDoseGrams": 15,
  "targetWaterGrams": 250,
  "expectedYieldGrams": 220,
  "expectedFinishMinSec": 165,
  "expectedFinishMaxSec": 195,
  "firstDropMinSec": null,
  "firstDropMaxSec": null,
  "flowUnit": "g_s",
  "targetTempC": 94,
  "defaultGrinderId": "uuid",
  "grindSettings": [
    { "grinderId": "uuid", "grinderName": "Comandante C40", "setting": "20" }
  ],
  "steps": [
    { "id": "uuid", "stepOrder": 1, "stepType": "bloom", "label": null, "durationSec": 45, "advance": "tap", "targetWaterGrams": 45, "targetTempC": 85, "pressureBar": null, "pressureEndBar": null, "flowRate": null, "flowEndRate": null },
    { "id": "uuid", "stepOrder": 2, "stepType": "pour", "label": "Main pour", "durationSec": 45, "advance": "auto", "targetWaterGrams": 250, "targetTempC": 93, "pressureBar": null, "pressureEndBar": null, "flowRate": null, "flowEndRate": null },
    { "id": "uuid", "stepOrder": 3, "stepType": "wait", "label": "Drawdown", "durationSec": null, "advance": "auto", "targetWaterGrams": null, "targetTempC": null, "pressureBar": null, "pressureEndBar": null, "flowRate": null, "flowEndRate": null }
  ]
}
```

An espresso profile (pressure until first drop, pump off for 10 s, then flow
down to 2 g/s until the shot is done):

```json
"steps": [
  { "stepType": "pressure", "pressureBar": 9, "advance": "first_drop", "durationSec": null },
  { "stepType": "soak", "advance": "auto", "durationSec": 10 },
  { "stepType": "flow", "flowRate": 4, "flowEndRate": 2, "advance": "auto", "durationSec": null }
]
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
    "brewerId": "uuid",
    "targetDoseGrams": 15,
    "targetWaterGrams": 250,
    "expectedYieldGrams": 220,
    "expectedFinishMinSec": 165,
    "expectedFinishMaxSec": 195,
    "targetTempC": 94,
    "grindSettings": [{ "grinderId": "uuid", "setting": "20" }],
    "steps": [
      { "stepType": "bloom", "durationSec": 45, "advance": "tap", "targetWaterGrams": 45, "targetTempC": 85 },
      { "stepType": "pour", "label": "Main pour", "durationSec": 45, "targetWaterGrams": 250, "targetTempC": 93 }
    ]
  }
  ```
  - Required: `name`, `brewerId` (a brewer in **this** workspace),
    `targetDoseGrams` (> 0, < 1000, max 2 decimals), and by kind (table
    above) `targetWaterGrams` or `expectedYieldGrams` (> 0, < 10000, max 2
    decimals).
  - Optional, nullable: `expectedYieldGrams` for pour-over/immersion (same
    rules as water), `targetTempC` (0–100, max 1 decimal). Recipes reach the
    public menu through drinks (§5c).
  - First-drop window (espresso only): `firstDropMinSec`/`firstDropMaxSec`,
    same pair rules as the finish window below but with a **±3 s** default.
  - Target finish window: `expectedFinishMinSec` and `expectedFinishMaxSec`
    (integers 0–86400, optional, nullable, min ≤ max). If only one is given,
    the other defaults to it **±15 s**: min 165 → max 180; max 195 → min 180
    (never below 0). So a stored window always has both ends, or neither.
  - `grindSettings` (default `[]`): each `grinderId` must be a grinder in this
    workspace (retired allowed), at most once; `setting` trimmed, 1–100 chars.
  - `defaultGrinderId` (optional, nullable): a grinder in this workspace
    (retired allowed). Deleting the grinder sets it back to `null`.
  - `flowUnit` (optional, default `g_s`): `g_s` or `ml_s`.
  - `steps` (default `[]`, max 20), in order (`stepOrder` = array position):
    - `stepType` allowed for the brewer's kind (tables above); `label`
      optional, ≤ 255 chars, blank becomes `null`.
    - `advance` (default `auto`) and `durationSec` (integer 0–86400, or
      `null`) as in the advance table. Only the last step may be open-ended.
    - The values allowed for the type (other values must be absent/`null`).
  - Not enforced (clients warn instead): the last pour reaching
    `targetWaterGrams`, and the finish window ending after the planned last
    step.
- **Success (`201 Created`):** `{ "recipe": { ...recipe } }`
- **Errors:** `400` invalid body, or `brewerId`/`grinderId` not in this
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
- **Errors:** `400` invalid or empty body, or `brewerId`/`grinderId` not in
  this workspace; `403` viewer; `404` recipe not in this workspace.

### `DELETE /api/workspaces/:workspaceId/recipes/:recipeId`

Deletes the recipe and its steps. Brew logs that used it are kept, with
`recipeId` set to `null`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` recipe not in this workspace.

---

## 5b. Ingredients

Reusable preps that finish a drink: orange-infused cold foam, steamed oat
milk, vanilla syrup, ice. Per workspace.

**Ingredient object:**
`{ "id": "uuid", "name": "Orange cold foam", "ingredientType": "foam", "instructions": "Infuse cream with orange peel overnight…", "drinkCount": 2 }`

- `ingredientType`: one of `INGREDIENT_TYPES` (`milk`, `foam`, `syrup`, `ice`,
  `water`, `other`; default `other`).
- `instructions`: free text, optional, ≤ 5000 chars, blank becomes `null`.
- `drinkCount`: how many drinks use it (read-only).

### `GET /api/workspaces/:workspaceId/ingredients`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "ingredients": [ { ...ingredient } ] }`, sorted by `name`.

### `POST /api/workspaces/:workspaceId/ingredients`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Orange cold foam", "ingredientType": "foam", "instructions": "…" }`
  (`name` trimmed, 1–100 chars, unique per workspace, case-insensitive)
- **Success (`201 Created`):** `{ "ingredient": { ...ingredient } }`
- **Errors:** `400`; `403` viewer; `409` name taken.

### `PATCH /api/workspaces/:workspaceId/ingredients/:ingredientId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields.
- **Success (`200 OK`):** `{ "ingredient": { ...ingredient } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

### `DELETE /api/workspaces/:workspaceId/ingredients/:ingredientId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` drinks use it,
  with body `{ "error": "...", "drinkCount": 2 }`. Remove it from those drinks first.

---

## 5c. Drinks

What's served, and what the public menu (§7) lists alongside plain brews. A
drink is **built on one brewer** and can be brewed with **any recipe of that
brewer** (the **default**, if set, is preselected when brewing), then
finished with **ingredients**. "Latte" is an espresso machine plus steamed
milk; "The Atlas" is V60 plus orange cold foam. The plain brew ("V60") isn't
a drink: it's the brewer itself (§3).

A drink can be a **variant** of another drink (`parentDrinkId`), like a
cocktail riff: Vanilla Latte is a variant of Latte, and Iced Vanilla Latte a
variant of Vanilla Latte. A variant is a complete, independent drink (clients
create one by copying the parent); nothing is inherited after that. Its
brewer may differ from its parent's.

**Drink object:**

```json
{
  "id": "uuid",
  "name": "Vanilla Latte",
  "description": null,
  "brewer": { "id": "uuid", "name": "Linea Mini", "kind": "espresso" },
  "category": { "id": "uuid", "name": "Espresso milk drinks" },
  "parent": { "id": "uuid", "name": "Latte" },
  "variants": [{ "id": "uuid", "name": "Iced Vanilla Latte" }],
  "showOnPublicMenu": true,
  "defaultRecipeId": "uuid",
  "servingSize": 8,
  "servingUnit": "fl_oz",
  "ingredients": [
    { "ingredientId": "uuid", "name": "Steamed milk", "ingredientType": "milk", "amountValue": 6, "amountUnit": "fl oz", "note": null },
    { "ingredientId": "uuid", "name": "Vanilla syrup", "ingredientType": "syrup", "amountValue": 2, "amountUnit": "pump", "note": "in the milk" }
  ]
}
```

`servingSize` + `servingUnit` (`SERVING_UNITS`: `fl_oz`, `ml`) are the
drink's default size, or both `null`. Ingredient amounts are for that size;
clients scale them when a brew is made bigger or smaller (and, for a filter
brewer, the coffee batch too; an espresso shot stays as the recipe says).

`category` and `parent` are `null` when not set; `variants` (direct children
only) are sorted by name; `ingredients` are in their order. `defaultRecipeId`
is a recipe of the drink's brewer, or `null` (none set, or it was deleted).

### `GET /api/workspaces/:workspaceId/drinks`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "drinks": [ { ...drink } ] }`, sorted by `name`.

### `POST /api/workspaces/:workspaceId/drinks`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:**
  ```json
  {
    "name": "Vanilla Latte",
    "description": null,
    "brewerId": "uuid",
    "categoryId": "uuid",
    "parentDrinkId": "uuid",
    "showOnPublicMenu": true,
    "defaultRecipeId": "uuid",
    "servingSize": 8,
    "servingUnit": "fl_oz",
    "ingredients": [{ "ingredientId": "uuid", "amountValue": 2, "amountUnit": "pump", "note": null }]
  }
  ```
  - `name` trimmed, 1–255 chars; `description` optional, ≤ 500, blank
    becomes `null`; `showOnPublicMenu` defaults to `true`.
  - `brewerId` (required): a brewer in this workspace.
  - `categoryId` (optional, nullable): a drink category (§5d) in this workspace.
  - `parentDrinkId` (optional, nullable): another drink in this workspace.
  - `defaultRecipeId` (optional, nullable): a recipe in this workspace whose
    brewer is `brewerId`.
  - `servingSize` (> 0, ≤ 2000, 1 decimal) and `servingUnit` (`fl_oz` or
    `ml`): optional, nullable, both or neither.
  - `ingredients` (default `[]`, max 20, in order): each `ingredientId` a
    ingredient in this workspace (at most once). All optional and nullable:
    `amountValue` (> 0, ≤ 100000, 2 decimals); `amountUnit` (trimmed, ≤ 20,
    blank becomes `null`; free text, clients offer `fl oz`, `ml`, `g` plus
    the units already used); `note` ≤ 255 chars, blank becomes `null`. A unit
    without a value ("to taste") doesn't scale.
- **Success (`201 Created`):** `{ "drink": { ...drink } }`
- **Errors:** `400` invalid body, a brewer/category/parent/recipe/ingredient
  not in this workspace, or a default recipe of another brewer; `403` viewer.

### `PATCH /api/workspaces/:workspaceId/drinks/:drinkId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields. `ingredients`, if
  present, replaces the list. Changing `brewerId` without sending a matching
  `defaultRecipeId` clears a default of the old brewer.
- **Success (`200 OK`):** `{ "drink": { ...drink } }`
- **Errors:** as `POST`, plus `400` when `parentDrinkId` is the drink itself
  or one of its variants (at any depth); `404` not in this workspace.

### `DELETE /api/workspaces/:workspaceId/drinks/:drinkId`

Its variants move up to its own parent (or become top-level drinks). Brew
logs made for it are kept, with `drinkId` set to `null`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.

---

## 5d. Drink Categories

An ordered list per workspace that groups drinks and brewers: the first
choice when brewing (Category → Brewer or drink → Recipe), and the public
menu's sections ("Espresso milk drinks", "Specialty drinks").

**Category object:** `{ "id": "uuid", "name": "Specialty drinks", "position": 2 }`

### `GET /api/workspaces/:workspaceId/drink-categories`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "categories": [ { ...category } ] }`, by `position`.

### `POST /api/workspaces/:workspaceId/drink-categories`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Specialty drinks" }` (trimmed, 1–100 chars, unique
  per workspace, case-insensitive). It goes last.
- **Success (`201 Created`):** `{ "category": { ...category } }`
- **Errors:** `400`; `403` viewer; `409` name taken.

### `PATCH /api/workspaces/:workspaceId/drink-categories/:categoryId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "..." }`
- **Success (`200 OK`):** `{ "category": { ...category } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

### `PUT /api/workspaces/:workspaceId/drink-categories/order`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "categoryIds": ["uuid", "uuid"] }`: every category of the
  workspace exactly once, in the new order.
- **Success (`200 OK`):** `{ "categories": [ { ...category } ] }`
- **Errors:** `400` not exactly the workspace's categories; `403` viewer.

### `DELETE /api/workspaces/:workspaceId/drink-categories/:categoryId`

Drinks and brewers in it become uncategorised.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.

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
  "brewerId": "uuid",
  "brewer": { "id": "uuid", "name": "V60", "kind": "pour_over" },
  "drink": { "id": "uuid", "name": "The Atlas" },
  "servingSize": null,
  "servingUnit": null,
  "marks": [],
  "brewedBy": { "id": "uuid", "email": "barista@example.com" }
}
```

`recipe` is `null` when `recipeId` is `null` (no recipe used, or the recipe was
deleted later); its `expectedYieldGrams` is the recipe's current estimate (or
target, for espresso), for comparing with the measured `actualYieldGrams`, and
`methodKind` is its brewer's kind. `grinder` is
`null` when no grinder was recorded; a retired
grinder still appears here. `brewerId` / `brewer` (`{ "id", "name",
"kind" }`, retired ones included) is the brewer it was made with: set by the
API from the recipe, kept if the recipe later moves or is deleted, and `null`
for a brew without a recipe. `drink`
(`{ "id", "name" }`) is the drink it was for, or `null`. `marks` lists
the timer's marks (`{ "kind", "stepOrder", "atSec" }`, `stepOrder` `null`
except for `step_end`), earliest first. `userId` and `brewedBy` are `null` when the brewer deleted their
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
    "drinkId": "uuid",
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
  - `marks` (optional, default `[]`): when things actually happened, recorded
    by the timer: `[{ "kind": "first_drop", "atSec": 7.4 }, { "kind":
    "step_end", "stepOrder": 1, "atSec": 52 }]`. `kind` is one of
    `MARK_KINDS`; `atSec` is 0–`actualTimeSec` with at most 1 decimal.
    - `first_drop`: espresso brews only, at most one, no `stepOrder`. It can
      also be typed into the log form after the shot.
    - `step_end`: the real end of a step that waited for a tap or was logged
      (`stepOrder` 1–50, at most one per step); needs a `recipeId`.
  - `drinkId` (optional, nullable): the drink this brew was for, in this
    workspace. With a `recipeId`, the recipe's brewer must be the drink's
    brewer. A plain brew (just the V60) has no drink.
  - `servingSize` / `servingUnit` (optional, nullable; same rules as on a
    drink, both or neither): the size made, when a drink was scaled from its
    default. Only with a `drinkId`; on `PATCH`, checked against the log after
    the change when any of the three is sent.
  - There is no brewer field: the log takes its recipe's brewer. Unknown
    fields (e.g. the old `machineId`) are rejected.
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
  Unknown fields are rejected. `marks`, if present, replaces the whole list
  (`[]` clears it). Sending `recipeId` also sets the log's brewer to that
  recipe's. The espresso rule is checked against the log as it is after the
  change, but only when the request sends `recipeId`, `actualWaterGrams`,
  `actualYieldGrams` or `marks` (marks must also fit within `actualTimeSec`),
  so editing the notes of an old log whose recipe later moved to another
  brewer still works.
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
`showOnPublicMenu = true`. The menu lists active **brewers** (§3), **drinks**
(§5c) and beans.

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
    "sections": [
      {
        "category": "Espresso milk drinks",
        "items": [
          {
            "kind": "drink",
            "id": "uuid",
            "name": "Vanilla Latte",
            "description": null,
            "brewer": "Espresso",
            "variantOf": "Latte",
            "ingredients": ["Steamed milk", "Vanilla syrup"]
          }
        ]
      },
      {
        "category": null,
        "items": [
          {
            "kind": "brewer",
            "id": "uuid",
            "name": "V60",
            "description": "Single-origin pour over",
            "brewer": "V60",
            "variantOf": null,
            "ingredients": []
          }
        ]
      }
    ]
  }
  ```
  Sections follow the categories' `position`; uncategorised items come last
  (`category: null`), and empty sections are left out. In each section, plain
  brewers come first, then drinks, each sorted by name. A brewer shows under
  its `menuName` if set, else its name; `brewer` is that menu name (for a
  drink, its brewer's); `variantOf` the parent drink's name if that drink is also
  shown, else `null`; `ingredients` are the ingredients' names in the drink's
  order. Recipe details (doses, steps) aren't published.
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
   - The brew includes its `drink` (or `null`): name, `servingSize` (the size
     made, else the drink's default, e.g. `"12 fl oz"`, or `null`) and
     ingredients (name, type, amount scaled to that size such as
     `"3 pump"`, note), since tasting notes may describe the whole drink
     (e.g. with milk) rather than the coffee alone.
   - Espresso brews include their `machine` (or `null`): the log's brewer's
     name and capabilities (pre-infusion, flow and pressure control).
   - Each brew includes its `marks` (`{ kind, stepOrder, atSec }`): the first
     drop for espresso, and the real end of steps that waited for a tap or
     were logged, so the LLM sees e.g. that the bloom ran 52 s, not 45.
   - Each brew includes its recipe's `methodKind` (or `null` without a
     recipe), `actualWaterGrams` (`null` for espresso), the measured
     `actualYieldGrams` (or `null`) and `brewRatio`: water ÷ dose, or for
     espresso yield ÷ dose. The recipe includes its brewer, kind, water,
     expected yield (the target for espresso), finish window
     (`expectedFinishMinSec`/`MaxSec`), first-drop window (espresso), flow
     unit, and its steps with type, label, duration, how each moves on, and
     their values (pour-to, temperature, pressure, flow).
2. It calls the LLM API using **Structured Outputs** (strict JSON schema mode).

**System Prompt:**

> "You are an expert specialty coffee roaster and barista. Analyze the provided
> extraction log and historical brews for this coffee bean, including roast
> level, roast age, dose, yield, total brew time, rating, and tasting notes. Suggest
> concrete parameter adjustments for the next brew. If the brew was served as
> a drink with milk or other ingredients, its tasting notes may describe the
> whole drink; judge the coffee's extraction. For espresso, judge flow
> from the first drop time, shot time and ratio against the recipe's
> windows, and consider the machine's capabilities (pre-infusion, flow and
> pressure control) and the grinder's step size when explaining the change.
> Respond strictly matching the provided JSON schema."

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
