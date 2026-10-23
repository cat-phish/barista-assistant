# 6. Brew Logs

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

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
  "tdsPercent": 1.38,
  "actualTempC": 93,
  "grinderId": "uuid",
  "waterProfileId": "uuid",
  "actualGrindSetting": "18 clicks",
  "actualTimeSec": 150,
  "rating": 3,
  "tastingNotes": "Sour, thin body",
  "drinkRating": null,
  "drinkTastingNotes": null,
  "bean": { "id": "uuid", "roasterName": "Onyx Coffee Lab", "beanName": "Southern Weather" },
  "recipe": { "id": "uuid", "name": "House V60", "expectedYieldGrams": 220, "style": "pour_over", "methodKind": "filter" },
  "grinder": { "id": "uuid", "name": "Comandante C40" },
  "waterProfile": { "id": "uuid", "name": "Third Wave Water (classic)" },
  "brewerId": "uuid",
  "brewer": { "id": "uuid", "name": "V60", "kind": "filter" },
  "drink": { "id": "uuid", "name": "The Atlas", "hasIngredients": true },
  "servingSize": null,
  "servingUnit": null,
  "marks": [],
  "tools": [{ "id": "uuid", "name": "Rinsed paper filter", "methodKind": "filter" }],
  "brewedBy": { "id": "uuid", "email": "barista@example.com" }
}
```

`recipe` is `null` when `recipeId` is `null` (no recipe used, or the recipe was
deleted later); its `expectedYieldGrams` is the recipe's current estimate (or
target, for espresso), for comparing with the measured `actualYieldGrams`,
`style` is its style (or `null`), which decides how extraction yield is worked
out, and `methodKind` is its brewer's kind. `grinder` is
`null` when no grinder was recorded; an archived
grinder still appears here. `waterProfile` (`{ "id", "name" }`, §3c) is the
water used, or `null`; archived ones still appear. `brewerId` / `brewer` (`{ "id", "name",
"kind" }`, archived ones included) is the brewer it was made with: set by the
API from the recipe, kept if the recipe later moves or is deleted, and `null`
for a brew without a recipe. `drink`
(`{ "id", "name", "hasIngredients" }`) is the drink it was for, or `null`;
`hasIngredients` tells clients to show the shot and the drink tasting apart. `marks` lists
the timer's marks (`{ "kind", "stepOrder", "atSec" }`, `stepOrder` `null`
except for `step_end`), earliest first. `tools` lists the prep tools used
(§3d, `{ "id", "name", "methodKind" }`, archived ones included) in checklist
order; `[]` when none were recorded. `userId` and `brewedBy` are `null` when the brewer deleted their
account. Such logs can only be edited or deleted by owners.

## `GET /api/workspaces/:workspaceId/brew-logs`

- **Auth Required:** `true` (any member)
- **Query (all optional):** `beanId`, `recipeId` (filters); `limit` (1–100,
  default 50); `offset` (default 0).
- **Success (`200 OK`):** `{ "brewLogs": [ ...brewLog ], "total": 123 }`, newest
  `timestamp` first. `total` counts all matches, ignoring `limit`/`offset`.
- **Errors:** `400` invalid query.

## `GET /api/workspaces/:workspaceId/brew-logs/:brewLogId`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewLog": { ...brewLog, "latestAnalysis": LlmAnalysis | null } }`,
  where `latestAnalysis` is the newest `llm_analyses` row for this log.
- **Errors:** `404` log not in this workspace.

## `POST /api/workspaces/:workspaceId/brew-logs`

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
    "waterProfileId": "uuid",
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
    workspace. With a `recipeId`, the recipe's brewer must be of the drink's
    kind (any such brewer). A plain brew (just the V60) has no drink.
  - `servingSize` / `servingUnit` (optional, nullable; same rules as on a
    drink, both or neither): the size made, when a drink was scaled from its
    default. Only with a `drinkId`; on `PATCH`, checked against the log after
    the change when any of the three is sent.
  - There is no brewer field: the log takes its recipe's brewer. Unknown
    fields (e.g. the old `machineId`) are rejected.
  - `toolIds` (optional): the prep tools used (§3d), each once, all from this
    workspace (archived ones accepted). A tool's `methodKind` isn't checked
    against the recipe; it only decides where the checklist shows it. On
    `PATCH` the list replaces the old one; `[]` clears it.
  - `beanId`, plus `recipeId`, `grinderId` and `waterProfileId` (all
    optional, nullable), must belong to **this** workspace. An archived grinder
    or water profile is accepted (e.g. when logging an old brew afterwards);
    clients just don't offer them for new brews, and start on the default
    water profile (§3c) if there is one.
  - `timestamp` is optional (default: now). Backdating is allowed so a brew
    can be logged afterwards, but it can't be more than 5 minutes in the
    future (allowing for clock skew).
  - `utcOffsetMinutes` (optional, nullable): the logging device's offset
    from UTC in minutes, from −720 to 840 (e.g. `-420` for PDT). The worker
    uses it to get the brew's local calendar date, which roast age is
    counted to (§9), since roast and freeze dates are local dates. Clients
    send `-new Date().getTimezoneOffset()`. Returned on every brew log.
  - Grams and °C follow the recipe rules in §5 (`actualDoseGrams` 0–1000,
    `actualWaterGrams` 0–10000, both > 0, max 2 decimals; `actualTempC` 0–100,
    max 1 decimal, nullable).
  - `actualYieldGrams` is the **measured** beverage weight: optional,
    nullable, same rules as water. Unlike the recipe's rough
    `expectedYieldGrams`, it's a measurement, and clients show it against the
    recipe's expected yield.
  - `tdsPercent` (optional, nullable): a refractometer reading in %, > 0 and
    ≤ 30, max 2 decimals. **Extraction yield** isn't stored; clients and the
    worker (§9) work it out as `tdsPercent × beverage / actualDoseGrams`,
    rounded to 0.1 %. The beverage is `actualWaterGrams` for the `immersion`,
    `cold_brew` and `ibrik` styles (the liquid left in the grounds is as
    strong as the cup), else the measured `actualYieldGrams`; with no yield
    there's no extraction yield. Clients may also take a °Brix reading and
    convert it, `TDS = (0.0036 × Bx + 0.7897) × Bx − 0.0071` (as
    Beanconqueror does), rounded to 2 decimals; only `tdsPercent` is stored.
  - `actualTimeSec`: integer 0–86400 (24 hours). `rating`: integer **1–5**,
    nullable. `actualGrindSetting` ≤ 100 chars, `tastingNotes` ≤ 5000 chars;
    both nullable, and blank becomes `null`. `rating` and `tastingNotes` are
    **the coffee tasted on its own**.
  - `drinkRating` (1–5) and `drinkTastingNotes` (≤ 5000), both optional and
    nullable: **the finished drink**, for a brew made for a drink (`400`
    otherwise; on `PATCH`, checked against the log after the change, so
    clearing the drink means clearing these too). Clients show both groups when
    the drink has ingredients; for a milk drink the straight tasting is
    optional (only if the shot was tasted on its own).
- **Success (`201 Created`):** `{ "brewLog": { ...brewLog } }`
- **Errors:** `400` invalid body, or `beanId`/`recipeId`/`grinderId`/
  `waterProfileId`/`toolIds` not in this workspace; `403` viewer.
- Logging a brew does **not** change the bean's `inventoryWeightGrams`.

## `PATCH /api/workspaces/:workspaceId/brew-logs/:brewLogId`

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

## `DELETE /api/workspaces/:workspaceId/brew-logs/:brewLogId`

Deletes the log and its `llm_analyses` (cascade).

- **Auth Required:** `true` (owner, or the barista who created it)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer, or a barista deleting someone else's log; `404` log
  not in this workspace.
