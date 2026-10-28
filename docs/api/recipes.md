# 5. Recipes

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

A recipe describes how to brew: `targetDoseGrams` of coffee and
`targetWaterGrams` of water (the **coffee:water ratio** is dose:water, e.g.
15 g : 250 g = 1:16.7, calculated by clients), plus an optional estimate of
the beverage yield, an optional **target finish window** for the total brew
time, and an optional water temperature.

**Flash chilled** (brewed onto ice, e.g. Japanese iced pour over): a filter
recipe can add `targetIceGrams`, the ice in the server the hot water drips
onto. The ratio then counts the ice, dose:(water + ice), shown as
"15 g : 250 g (150 g water + 100 g ice · 1:16.7)"; `targetWaterGrams` is the
hot water and the pour targets count it only. It works with any style (a V60
onto ice still brews like `pour_over`); the recipe form asks for it with a
"Flash chilled" checkbox, in place of a serving dilution. `expectedYieldGrams` includes the
ice. Brews made onto ice take no TDS reading (§6).

**Concentrate** (brewed strong, then diluted, e.g. a hot concentrate poured
over ice): any filter recipe with a serving dilution, `dilutionRatio` and
`dilutionWith` (below), is one; there's no style or flag for it, and the
style still says how it extracts. Unlike flash chilled, the TDS is read on
the concentrate before it's diluted, so extraction yield works as usual
(§6), and the AI judges the cup as served, after the dilution (§9).

**By brewer kind** (§3), checked against the recipe as it is after the
request (so a `PATCH` that changes `brewerId` must also send the fields the
new kind needs):

| | `filter` | `espresso` |
|---|---|---|
| `targetWaterGrams` | required | must be absent/`null` |
| `targetIceGrams` | optional (flash chilled) | must be absent/`null` |
| `expectedYieldGrams` | optional estimate | **required**: target shot weight; ratio is dose:yield (18 g → 36 g = 1:2) |
| finish window | total brew time | total shot time |
| `firstDropMinSec`/`MaxSec` | must be absent/`null` | optional window (pair, ±3 s default) |
| step types | `bloom` `pour` `swirl` `stir` `wait` `press` `other` | `preinfusion` `soak` `pressure` `flow` `other` (`ESPRESSO_STEP_TYPES`) |
| step `advance` | `auto`, `auto_log`, `tap` | also `first_drop` (at most one step) |
| `flowUnit` | ignored (default `g_s`) | `g_s` or `ml_s` for flow steps |
| `stepTimeScaling` | optional | must be absent/`null` |

Recipes are grinder-neutral: instead of one grind setting they carry
**approximate starting points per grinder** (`grindSettings`). The brew flow
uses one only when there's no actual setting from your last brew with that
grinder and recipe (§3b `last-setting`). A recipe can name a
**`defaultGrinderId`**: the grinder the brew flow preselects for it (instead
of the last grinder used), if that grinder isn't archived.

**Default prep** (`prepToolIds`): prep tools (§3d) brew setup ticks when the
recipe is chosen, the active ones still offered for its brewer. A repeat
ticks the repeated brew's prep instead (`docs/api/auth.md` §1
repeatKeeps); without defaults, setup ticks what was last ticked with the
brewer, if remembered (§1 rememberSetup), else nothing.

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
- **Step times with the batch** (`stepTimeScaling`, filter only, nullable,
  above 0 up to 1, 2 decimals): when a brew scales the batch (water ÷ the
  recipe's water = the factor), `pour` and `wait` steps take
  `durationSec × factor ^ stepTimeScaling`, to the second; other steps keep
  their time, and open-ended ones stay open. 1 is linear; 0.5 (what clients
  offer first) makes a double batch's 1:00 pour 1:25. The target finish
  window moves by the seconds the steps gained or lost (both ends, never
  below 0). `null` (the default): step times stay the same. Clients and the
  worker (§9) work it out the same way; nothing scaled is stored.
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
  "brewer": { "id": "uuid", "name": "V60", "kind": "filter" },
  "targetDoseGrams": 15,
  "targetWaterGrams": 250,
  "targetIceGrams": null,
  "expectedYieldGrams": 220,
  "expectedFinishMinSec": 165,
  "expectedFinishMaxSec": 195,
  "firstDropMinSec": null,
  "firstDropMaxSec": null,
  "flowUnit": "g_s",
  "stepTimeScaling": null,
  "style": { "id": "uuid", "name": "Pour over", "brewsLike": "pour_over" },
  "targetTempC": 94,
  "defaultGrinderId": "uuid",
  "archivedAt": null,
  "createdAt": "2026-10-19T08:00:00.000Z",
  "grindSettings": [
    { "grinderId": "uuid", "grinderName": "Comandante C40", "setting": 20 }
  ],
  "prepToolIds": ["uuid", "uuid"],
  "steps": [
    { "id": "uuid", "stepOrder": 1, "stepType": "bloom", "label": null, "durationSec": 45, "advance": "tap", "targetWaterGrams": 45, "targetTempC": 85, "pressureBar": null, "pressureEndBar": null, "flowRate": null, "flowEndRate": null },
    { "id": "uuid", "stepOrder": 2, "stepType": "pour", "label": "Main pour", "durationSec": 45, "advance": "auto", "targetWaterGrams": 250, "targetTempC": 93, "pressureBar": null, "pressureEndBar": null, "flowRate": null, "flowEndRate": null },
    { "id": "uuid", "stepOrder": 3, "stepType": "wait", "label": "Drawdown", "durationSec": null, "advance": "auto", "targetWaterGrams": null, "targetTempC": null, "pressureBar": null, "pressureEndBar": null, "flowRate": null, "flowEndRate": null }
  ]
}
```

`createdAt` is when the recipe was added (read-only; recipes that existed
before it was tracked date from their first brew). A duplicate is a new
recipe with its own date.

An espresso profile (pressure until first drop, pump off for 10 s, then flow
down to 2 g/s until the shot is done):

```json
"steps": [
  { "stepType": "pressure", "pressureBar": 9, "advance": "first_drop", "durationSec": null },
  { "stepType": "soak", "advance": "auto", "durationSec": 10 },
  { "stepType": "flow", "flowRate": 4, "flowEndRate": 2, "advance": "auto", "durationSec": null }
]
```

`grindSettings` are sorted by grinder name and include archived grinders.
`prepToolIds` are in checklist order (the tools' `position`) and include
archived tools.
`steps` are in `stepOrder` and may be empty.

## `GET /api/workspaces/:workspaceId/recipes`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "recipes": [ { ...recipe } ] }`, sorted by `name`.

## `POST /api/workspaces/:workspaceId/recipes`

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
    "grindSettings": [{ "grinderId": "uuid", "setting": 20 }],
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
  - `styleId` (optional, nullable): how the cup is brewed, one of the
    workspace's styles for its brewer's method (§5e; hidden ones included).
    `400` for another workspace's style or another method's. Responses carry
    it as `style: { id, name, brewsLike }` or `null`. It changes no fields or
    timer behaviour; extraction yield and the AI go by `brewsLike`. Stovetop
    and other recipes follow filter's rules (dose + water). On `PATCH`,
    moving the recipe to a brewer of another method clears a style that no
    longer fits, unless a fitting one is sent.
  - Optional, nullable: `expectedYieldGrams` and `targetIceGrams` for filter
    recipes (same rules as water), `targetTempC` (0–100, max 1 decimal). Recipes reach the
    public menu through drinks (§5c).
  - First-drop window (espresso only): `firstDropMinSec`/`firstDropMaxSec`,
    same pair rules as the finish window below but with a **±3 s** default.
  - Target finish window: `expectedFinishMinSec` and `expectedFinishMaxSec`
    (integers 0–86400, optional, nullable, min ≤ max). If only one is given,
    the other defaults to it **±15 s**: min 165 → max 180; max 195 → min 180
    (never below 0). So a stored window always has both ends, or neither.
  - `grindSettings` (default `[]`): each `grinderId` must be a grinder in this
    workspace (archived allowed), at most once; `setting` is the number on
    the grinder's dial, 0 ≤ x < 10000 with at most 2 decimals (like the
    grinder's `settingMin`, §3b). Text such as `"18 clicks"` is a `400`.
  - `defaultGrinderId` (optional, nullable): a grinder in this workspace
    (archived allowed). Deleting the grinder sets it back to `null`.
  - `prepToolIds` (default `[]`, max 100): prep tools of this workspace
    (archived allowed), each once; `400` "prepToolIds: must be prep tools
    of this workspace" otherwise. Not checked against the brewer: clients
    offer only the tools offered for it. Deleting a tool takes it off.
  - `flowUnit` (optional, default `g_s`): `g_s` or `ml_s`.
  - `stepTimeScaling` (optional, nullable): above 0, at most 1, 2 decimals;
    `400` on an espresso recipe (step times above).
  - **Cold styles** (§5e), all optional and nullable, accepted on any recipe;
    clients show them for cold styles, and the dilution for any filter
    recipe (a concentrate, above):
    - `steepMinHours` / `steepMaxHours`: the steep window of a long style
      (cold brew, Kyoto drip), 0.5–72 h, 1 decimal, a pair (both ends, min ≤
      max; `null` on either clears both). The steep reminder (§1b) comes at
      `steepMinHours`.
    - `steepTemp`: `fridge` or `room` (`STEEP_TEMPS`).
    - `dilutionRatio` (> 0, ≤ 10, 1 decimal) and `dilutionWith` (`water`,
      `milk`, `ice`, `other`): served 1 : `dilutionRatio`, e.g. `1` = half
      concentrate, half water.
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

## `PATCH /api/workspaces/:workspaceId/recipes/:recipeId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields, with the same rules.
  Unknown fields are rejected. The optional fields can be set to `null`.
  The finish and first-drop windows are each treated as a pair: sending only
  one end applies the default spread to the other; setting one end to `null`
  clears both. The kind rules apply to the recipe as it is after the change.
  `steps`, `grindSettings` and `prepToolIds`, if present, each **replace** their whole list
  (`[]` clears it); if absent, they're unchanged.
  Also `"archived": true | false`, like a bean's (§4): `true` sets
  `archivedAt` (unchanged if already archived), `false` restores the recipe.
  Sent alone, the recipe rules aren't re-checked. Clients leave archived
  recipes off the brew page and the drink form's default-recipe picker; brews
  and drinks that already use one keep it.
- **Success (`200 OK`):** `{ "recipe": { ...recipe } }`
- **Errors:** `400` invalid or empty body, or `brewerId`/`grinderId` not in
  this workspace; `403` viewer; `404` recipe not in this workspace.

## `GET /api/workspaces/:workspaceId/recipes/:recipeId/usage`

What deleting it would take with it (see README, "Deleting").

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewLogCount": 12, "drinkCount": 1 }`: brews made with it, and drinks with it as their default recipe.
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/recipes/:recipeId`

Deletes the recipe and its steps. Brew logs that used it are kept, with
`recipeId` set to `null`; drinks lose it as their default. Clients warn
first, from `/usage`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` recipe not in this workspace.
