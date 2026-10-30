# 11. Statistics

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The Insights page (`docs/roadmap.md`, "Insights") charts a workspace's brews and
beans. The API sends compact rows, and the client adds them up
(`frontend/src/lib/stats.ts`): the Explore chart needs a point per brew, and
per-day buckets need each brew's local date. Notes and other text are left
out to keep the reply small.

## `GET /api/workspaces/:workspaceId/stats`

- **Auth Required:** `true` (any member, viewers included)
- **Query** (all optional):

| Param | Meaning |
|---|---|
| `from`, `to` | `YYYY-MM-DD`, inclusive, compared with the brew's **local** date: `timestamp` shifted by `utcOffsetMinutes` (UTC when that's `null`, as in the CSV export). `from` ≤ `to`. |
| `beanId`, `recipeId`, `brewerId` | only brews of that bean, recipe or brewer |
| `mine` | `1`: only the caller's own brews |

- **Success (`200 OK`):**

```json
{
  "brews": [
    {
      "id": "uuid",
      "timestamp": "2026-10-20T07:12:00.000Z",
      "utcOffsetMinutes": -420,
      "userId": "uuid",
      "beanId": "uuid",
      "recipeId": "uuid",
      "brewerId": "uuid",
      "methodId": "uuid",
      "styleId": "uuid",
      "brewsLike": "pour_over",
      "grinderId": "uuid",
      "drinkId": null,
      "toolIds": ["uuid"],
      "problemIds": [],
      "doseGrams": 15,
      "waterGrams": 250,
      "iceGrams": null,
      "yieldGrams": null,
      "servingSize": null,
      "servingUnit": null,
      "drinkServingSize": null,
      "drinkServingUnit": null,
      "dilutionRatio": null,
      "timeSec": 165,
      "expectedFinishMinSec": 150,
      "expectedFinishMaxSec": 180,
      "grindSetting": 22,
      "tempC": 94,
      "tdsPercent": 1.38,
      "rating": 4,
      "drinkRating": null
    }
  ],
  "beans": [
    {
      "id": "uuid",
      "roasterName": "Onyx",
      "beanName": "Southern Weather",
      "batchNumber": null,
      "country": "Colombia, Ethiopia",
      "originArea": "south_america",
      "altitudeMasl": 1900,
      "processId": "uuid",
      "roastLevel": "light",
      "roastDate": "2026-10-01T00:00:00.000Z",
      "varieties": ["Caturra"],
      "species": ["arabica"],
      "decaf": false,
      "priceAmount": 22.5,
      "priceCurrency": "USD",
      "bagWeightGrams": 340,
      "inventoryWeightGrams": 120,
      "purchaseDate": "2026-10-03",
      "createdAt": "2026-10-03T10:00:00.000Z",
      "archivedAt": null,
      "freezes": [{ "frozenOn": "2026-10-05", "thawedOn": null }],
      "photoCount": 2
    }
  ],
  "lookups": {
    "brewers": [{ "id": "uuid", "name": "V60", "methodId": "uuid" }],
    "methods": [{ "id": "uuid", "name": "Pour over" }],
    "styles": [{ "id": "uuid", "name": "Pour over", "brewsLike": "pour_over" }],
    "recipes": [{ "id": "uuid", "name": "Daily V60", "expectedFinishMinSec": 165, "expectedFinishMaxSec": 195 }],
    "grinders": [{ "id": "uuid", "name": "Comandante C40" }],
    "tools": [{ "id": "uuid", "name": "WDT" }],
    "problems": [{ "id": "uuid", "name": "Channeling" }],
    "processes": [{ "id": "uuid", "name": "Washed" }],
    "drinks": [{ "id": "uuid", "name": "Latte" }]
  }
}
```

- **`brews`:** the matching brews, oldest first. Each field is the log's
  own (§6), renamed without the `actual` prefix. In addition:
  - `methodId`: the brewer's method (§3e).
  - `styleId` and `brewsLike`: the recipe's style (§5e). Extraction yield
    needs `brewsLike`.
  - `drinkServingSize` and `drinkServingUnit`: the drink's default size
    (§5c), used when the brew didn't record its own.
  - **Left out:** steeping brews (`steeping: true`). They aren't finished.
- **`beans`:** every bean in the workspace, archived ones included, whatever
  the filters are. Bean totals (stock, spend) cover all of them.
  - `freezes`: the bean's freeze periods, oldest first (§4).
  - `photoCount`: how many photos the bean has (§4c).
- **`lookups`:** names for every id the rows use. A recipe also has its
  finish window (§5); a brew's own window (rapid cold, §6) wins over it. Archived and hidden ones
  are included, so history keeps its names.
- **Errors:** `400` an invalid query (a bad date, `from` after `to`, or an
  id that isn't a UUID); `404` the caller isn't a member.

## How the client counts

Recorded here because the numbers aren't stored anywhere:

- **Volume drunk**, per brew, comes from the first of these that exists:
  1. a drink's serving size: the brew's own, else the drink's default;
  2. the measured yield;
  3. the estimated yield: water + ice − retention × dose, where retention
     is the bean's roast-level figure (`frontend/src/lib/scale.ts`).

  A brew served diluted (`dilutionRatio`, served 1 : ratio) counts the
  diluted volume, yield × (1 + ratio). 1 g counts as 1 ml. Totals that
  include an estimate are shown with "≈".
- **Coffee used:** the sum of `doseGrams`. Logging a brew doesn't change a
  bean's stock (§6).
- **Caffeine** (`frontend/src/lib/caffeine.ts`), also shown on a brew's
  journal entry, is an estimate, always shown with "≈":
  mg = dose (g) × 1000 × the bean's caffeine share × share extracted.
  - Caffeine share by species: arabica 1.2%, robusta 2.2%, liberica 1.2%,
    excelsa 1.1%, eugenioides 0.6%. A blend counts each species equally;
    no species counts as arabica.
  - Decaf: × 0.03.
  - Share extracted: 0.8 for espresso (the brew with no `waterGrams`), else
    0.9.
  - A brew counts its whole dose, on the day it's logged: the log doesn't say
    how much of a batch was drunk.
  - Caffeine/Day divides the total by the calendar days in the period, quiet
    days included: from the period's start (the first brew when open) to its
    end, never past today.
- **Beans available:** beans that aren't archived and have stock left, by
  freeze state:
  - frozen: a freeze is still open;
  - thawed: frozen before, none open now;
  - fresh: never frozen.
- **Money spent:** bean prices added up per currency, never converted. A
  bean counts on its `purchaseDate`, else on the date it was added.
- **Country:** a blend's list ("Colombia, Ethiopia") counts toward each
  country.

## 11b. Added charts

A person keeps charts on the Insights tabs: an Explore view on any tab, or a
built-in chart on the Overview, and lays out each tab: the charts' order, and
which built-in ones are hidden. Both are each person's own, per workspace,
stored on their membership (`workspace_members.insight_charts`,
`insight_layout`). It goes when
they leave the workspace and isn't in backups (people and members aren't,
§2b). It names this workspace's grinder ids too, so it wouldn't carry over
anyway.

### `GET /api/workspaces/:workspaceId/stats/charts`

- **Auth Required:** `true` (any member, viewers included)
- **Success (`200 OK`):** `{ "charts": [...], "layout": {...} }`: the
  charts in the order they were added (`[]` when none), and the layout
  (`{}` when every tab is as built; see `PUT .../layout`).

### `PUT /api/workspaces/:workspaceId/stats/charts`

- **Auth Required:** `true` (any member, viewers included: it's their own
  layout)
- **Body:** `{ "charts": [...] }`, the whole list. It replaces the old one.

```json
{
  "charts": [
    { "id": "uuid", "kind": "explore", "tab": "brews", "x": "tds", "y": "rating", "color": "process", "grinder": "uuid" },
    { "id": "uuid", "kind": "chart", "tab": "overview", "chart": "brews.rating" }
  ]
}
```

- `kind: "explore"`: `tab` is one of `overview`, `brews`, `beans`,
  `methods`, `recipes`, `tools`, `grinders`. `x`, `y`, `color` are Explore
  field keys (letters only, up to 40). `grinder` is the grinder a grind
  setting is compared on. The server doesn't check the keys against
  Explore's list: the client owns that list and leaves out a chart whose
  field it doesn't know or the workspace hides.
- `kind: "chart"`: a built-in chart (`<tab>.<chart>`, e.g. `beans.spend`),
  only on `overview`, each chart once.
- At most 50 charts, each `id` (a UUID, made by the client) once. Unknown
  keys are refused.
- **Success (`200 OK`):** `{ "charts": [...] }` as saved.
- **Errors:** `400` for a bad list, `404` outside the workspace.

### `PUT /api/workspaces/:workspaceId/stats/layout`

- **Auth Required:** `true` (any member, viewers included)
- **Body:** `{ "layout": {...} }`, every tab's layout. It replaces the old one.

```json
{
  "layout": {
    "brews": { "order": ["brews.rating", "pin:uuid", "brews.total"], "hidden": ["brews.problems"] },
    "overview": { "order": ["tile.rating", "tile.brews", "beans.spend", "brews.rating"], "hidden": ["tile.photos"], "tilesBelow": true }
  }
}
```

- Keys are tabs (`overview`, `brews`, `beans`, `methods`, `recipes`,
  `tools`, `grinders`), each with optional `order` and `hidden`, at most 100
  ids each, each id once. A tab left out is as built.
- An id is a built-in chart's (`brews.rating`), an Overview tile's
  (`tile.brews`, `tile.coffee`, …) or an added chart's (`pin:<its id>`).
  Only built-in ids (charts and tiles) go in `hidden`: an added chart is
  removed instead (`PUT .../charts`). On the Overview, a pinned built-in
  chart is taken off rather than hidden.
- `tilesBelow` (the Overview's): `true` puts the tiles under the charts.
  The tiles and the charts are ordered within their own groups; one `order`
  list holds both.
- `order` is the order shown. Charts it doesn't name (new ones, say) follow
  in their usual order: a tab's template order, or on the Overview the order
  they were added. Ids for charts not on the page are kept and ignored.
- **Success (`200 OK`):** `{ "layout": {...} }` as saved.
- **Errors:** `400` for a bad layout, `404` outside the workspace.
