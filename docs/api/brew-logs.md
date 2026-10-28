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
  "actualIceGrams": null,
  "actualYieldGrams": 225,
  "tdsPercent": 1.38,
  "actualTempC": 93,
  "grinderId": "uuid",
  "waterProfileId": "uuid",
  "actualGrindSetting": 18,
  "grindRpm": null,
  "beanWeightInGrams": 15.2,
  "groundWeightOutGrams": 15,
  "actualTimeSec": 150,
  "steeping": false,
  "steepTemp": null,
  "dilutionRatio": null,
  "dilutedWith": null,
  "steepMinHours": null,
  "steepMaxHours": null,
  "expectedFinishMinSec": null,
  "expectedFinishMaxSec": null,
  "rating": 3,
  "tastingNotes": "Sour, thin body",
  "drinkRating": null,
  "drinkTastingNotes": null,
  "bean": { "id": "uuid", "roasterName": "Onyx Coffee Lab", "beanName": "Southern Weather", "batchNumber": null },
  "recipe": { "id": "uuid", "name": "House V60", "expectedYieldGrams": 220, "style": { "id": "uuid", "name": "Pour over", "brewsLike": "pour_over" }, "methodKind": "filter" },
  "grinder": { "id": "uuid", "name": "Comandante C40" },
  "waterProfile": { "id": "uuid", "name": "Third Wave Water (classic)" },
  "brewerId": "uuid",
  "brewer": { "id": "uuid", "name": "V60", "kind": "filter" },
  "drink": { "id": "uuid", "name": "The Atlas", "hasIngredients": true },
  "servingSize": null,
  "servingUnit": null,
  "marks": [],
  "tools": [{ "id": "uuid", "name": "Rinsed paper filter" }],
  "problems": [{ "id": "uuid", "name": "Slow drawdown / stalled bed", "methodKind": "filter" }],
  "brewedBy": { "id": "uuid", "email": "barista@example.com" },
  "analyzed": false,
  "analysisDueAt": "2026-10-23T09:15:00.000Z",
  "analysisError": null
}
```

`recipe` is `null` when `recipeId` is `null` (no recipe used, or the recipe was
deleted later); its `expectedYieldGrams` is the recipe's current estimate (or
target, for espresso), for comparing with the measured `actualYieldGrams`,
`style` is its style (`{ id, name, brewsLike }`, §5e, or `null`), whose
`brewsLike` decides how extraction yield is worked out, and `methodKind` is its brewer's kind. `grinder` is
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
(§3d, `{ "id", "name" }`, archived ones included) in checklist order; `[]`
when none were recorded. `problems` lists what went wrong (§6b,
`{ "id", "name", "methodKind" }`, archived ones included) in list order; `[]` when none
were recorded. `userId` and `brewedBy` are `null` when the brewer deleted their
account. Such logs can only be edited or deleted by owners. `analyzed` says
whether it has at least one AI suggestion; `analysisDueAt` is when an
automatic analysis is due (auto-analyze, §8), else `null`; `analysisError`
says why the last analysis failed or wasn't made (e.g. the daily cap), else
`null`, cleared when it's asked for again.

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
    "actualGrindSetting": 18,
    "actualTimeSec": 150,
    "rating": 3,
    "tastingNotes": "Sour, thin body"
  }
  ```
  - Required: `beanId`, `actualDoseGrams`, `actualTimeSec`, and
    `actualWaterGrams`, except for **espresso**: when `recipeId` is an
    espresso recipe, `actualWaterGrams` must be absent/`null` and
    `actualYieldGrams` (the shot weight) is required.
  - `actualIceGrams` (optional, nullable, same rules as water): **flash
    chilled**, the ice in the server the hot water was brewed onto (§5).
    `actualWaterGrams` is then the hot water; the ratio is dose:(water + ice)
    and `actualYieldGrams` is the server weighed with the ice in it. Must be
    absent/`null` for espresso. A brew with ice takes **no TDS reading**:
    `tdsPercent` must be `null` when `actualIceGrams` is set (`400`), and it
    has no extraction yield.
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
  - `problemIds` (optional): what went wrong (§6b), with the same rules as
    `toolIds`: each once, all from this workspace (archived accepted), the
    method not checked, replaced on `PATCH`.
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
    rounded to 0.1 %. The beverage is `actualWaterGrams` for styles that brew
    like `immersion`, `cold_brew` or `ibrik` (custom ones by their `brewsLike`, §5e) (the liquid left in the grounds is as
    strong as the cup), else the measured `actualYieldGrams`; with no yield
    (or with ice, `actualIceGrams`) there's no extraction yield. Clients may also take a °Brix reading and
    convert it, `TDS = (0.0036 × Bx + 0.7897) × Bx − 0.0071` (as
    Beanconqueror does), rounded to 2 decimals; only `tdsPercent` is stored.
  - `grindRpm` (optional, nullable): the grinder's speed, an integer 50–5000,
    only with a `grinderId` whose grinder has `variableSpeed` (§3b), and
    within its `rpmMin`–`rpmMax` when it has a range. The range is checked
    only when `grindRpm` is sent, so an old brew stays editable after the
    range changes. On `PATCH` the grinder is checked against the log after
    the change, so moving a brew to a grinder without speed control means
    sending `grindRpm: null` too.
  - `beanWeightInGrams` / `groundWeightOutGrams` (optional, nullable, each
    on its own): the beans weighed before grinding and the grounds that came
    out, same rules as `actualDoseGrams`. When both are given, out can't be
    more than in (on `PATCH`, checked after the change). **Grinder
    retention** isn't stored: clients and the worker (§9) work it out as
    in − out. `actualDoseGrams` stays the dose that went into the brew. This
    is coffee left in the grinder, not the water the spent grounds keep
    (which the yield estimate uses, §5).
  - **Cold styles** (§5e):
    - `steeping` (boolean, default `false`): a long cold brew (cold brew,
      Kyoto drip) is saved when it starts, with `steeping: true`.
      `timestamp` is the start, `actualTimeSec` is usually `0`, and there's
      no rating yet. It's **finished** with a `PATCH` sending
      `steeping: false` plus its steep time, yield, TDS, dilution and
      rating.
    - A steeping brew can't be analyzed (§8 `409`), and the AI leaves it
      out of other brews' history (§9). `POST` with `steeping: true` also
      queues the **steep reminder** when the recipe has a window (§1b). The
      reply adds `steepReminder`: `queued`, `off` or `unavailable`.
    - `steepTemp` (`fridge` | `room`), `dilutionRatio` (> 0, ≤ 10, 1
      decimal) and `dilutedWith` (`water` | `milk` | `ice` | `other`), all
      nullable: where it steeped and how it was served (1 :
      `dilutionRatio`). The dilution is accepted on any brew: clients ask
      for it on cold styles and on a concentrate's brews (recipes.md §5),
      whose `tdsPercent` is the concentrate's, before diluting.
    - **The brew's window**, `POST` only (not changed by `PATCH`, `400`),
      so the steep reminder queued at the start stays right:
      `steepMinHours` / `steepMaxHours` (0.5–72, 1 decimal) for a long
      brew, `expectedFinishMinSec` / `expectedFinishMaxSec` (0–86400 s)
      for rapid cold. Each pair is both or neither (`null` both for no
      window), min ≤ max. Clients start from the recipe's and let it be
      changed before the brew starts. Left out, a steeping brew takes its
      recipe's steep window; the finish window stays `null`. The steep
      reminder and "ready from" use the brew's `steepMinHours`. Brews from
      before migration 0059 got their recipe's steep window then.
  - `actualTimeSec`: integer 0–604800 (7 days, for long steeps). `rating`: integer **1–5**,
    nullable. `actualGrindSetting` (nullable): the number on the grinder's
    dial, 0 ≤ x < 10000 with at most 2 decimals, as in `grindSettings` (§5);
    text is a `400`. `tastingNotes` ≤ 5000 chars, nullable, and blank
    becomes `null`. `rating` and `tastingNotes` are
    **the coffee tasted on its own**.
  - `drinkRating` (1–5) and `drinkTastingNotes` (≤ 5000), both optional and
    nullable: **the finished drink**, for a brew made for a drink (`400`
    otherwise; on `PATCH`, checked against the log after the change, so
    clearing the drink means clearing these too). Clients show both groups when
    the drink has ingredients; for a milk drink the straight tasting is
    optional (only if the shot was tasted on its own).
  - `remindToRate` (optional boolean, `POST` only, not stored): **Rate
    later**. Queues a reminder to rate this brew after the caller's delay
    (§1b), if they have reminders on and an enabled channel. The reply then
    adds `reminder`: `"queued"`, `"off"` or `"unavailable"`. The brew is
    saved either way.
- **Success (`201 Created`):** `{ "brewLog": { ...brewLog } }` (plus
  `reminder` when `remindToRate` was sent)
- **Errors:** `400` invalid body, or `beanId`/`recipeId`/`grinderId`/
  `waterProfileId`/`toolIds`/`problemIds` not in this workspace; `403` viewer.
- Logging a brew does **not** change the bean's `inventoryWeightGrams`.

## `PATCH /api/workspaces/:workspaceId/brew-logs/:brewLogId`

- **Auth Required:** `true` (owner, or the barista who created it)
- **Body:** any non-empty subset of the `POST` fields, with the same rules.
  Unknown fields are rejected. `marks`, if present, replaces the whole list
  (`[]` clears it). Sending `recipeId` also sets the log's brewer to that
  recipe's. The espresso rule is checked against the log as it is after the
  change, but only when the request sends `recipeId`, `actualWaterGrams`,
  `actualIceGrams`, `actualYieldGrams` or `marks` (marks must also fit within
  `actualTimeSec`), and so is TDS with ice when it sends `actualIceGrams` or
  `tdsPercent`, so editing the notes of an old log whose recipe later moved to another
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
