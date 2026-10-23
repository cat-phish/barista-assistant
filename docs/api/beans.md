# 4. Beans

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

## `GET /api/workspaces/:workspaceId/beans`

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
  Every endpoint that returns a bean includes `freezePeriods` and `frozen`
  (boolean): `true` while a period is open (`thawedOn: null`). `frozen` is
  worked out from the periods, not stored, so the two always agree; clients
  read it instead of looking at the order of the periods.

  The list includes archived beans: `archivedAt` is when the bean was
  archived, or `null` while it's active. `createdAt` is when it was added
  (beans from before migration 0031 have that migration's time). Clients
  show active and archived beans apart, and leave archived ones out of the
  brew picker; past brews and the AI keep them.

**Effective roast age** (days), computed by clients and the worker, as of
calendar date `D`:
`(D − roastDate) − Σ days frozen between roastDate and D`, where a period
counts from `frozenOn` up to `thawedOn` (or `D` while still frozen). So the
age stops while frozen and resumes after thawing. Without a `roastDate` there
is no age.

## `POST /api/workspaces/:workspaceId/beans`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:**
  ```json
  {
    "roasterName": "Onyx Coffee Lab",
    "beanName": "Southern Weather",
    "process": "washed",
    "roastDate": "2026-10-01",
    "inventoryWeightGrams": 250,
    "showOnPublicMenu": true,
    "roastType": "filter",
    "detailedRoastLevel": "city",
    "blendType": "single_origin",
    "decaf": false,
    "website": "https://onyxcoffeelab.com/products/southern-weather",
    "priceAmount": 21.5,
    "priceCurrency": "USD",
    "bagWeightGrams": 283,
    "notes": "Sweet and round. Roaster suggests 1:16.",
    "flavorProfile": "Milk chocolate, plum, cane sugar",
    "originArea": "south_america",
    "country": "Colombia",
    "region": "Huila",
    "altitudeMasl": 1950,
    "producer": "Finca El Paraíso",
    "purchaseDate": "2026-10-05",
    "greenSupplier": "Covoya",
    "rating": 4
  }
  ```
  `roasterName` and `beanName` are required (trimmed, 1–255 chars).
  `process` (one of `BEAN_PROCESSES`: `washed`, `natural`, `wet_hulled`,
  `honey`, `mechanically_washed`, `anaerobic`, `carbonic_maceration`,
  `co_fermentation`, `thermal_shock`, `lactic`), `roastLevel` (one of
  `ROAST_LEVELS`: `light`, `medium_light`, `medium`, `medium_dark`, `dark`;
  see `detailedRoastLevel` below) and `roastDate` (ISO date or datetime) are
  optional and nullable. `inventoryWeightGrams` is an integer ≥ 0 (default `0`).
  `showOnPublicMenu` defaults to `true`.

  Optional details, all nullable except `decaf`:
  - `roastType`: what it was roasted for, one of `ROAST_TYPES` (`filter`,
    `espresso`, `omni`); `null` = unknown.
  - `detailedRoastLevel`: one of `DETAILED_ROAST_LEVELS`, lightest to
    darkest: `cinnamon`, `american`, `new_england`, `half_city`,
    `modern_light`, `city`, `city_plus`, `full_city`, `full_city_plus`,
    `italian`, `vienna`, `french`. Each implies a `roastLevel`
    (`DETAILED_ROAST_TO_LEVEL` in `docs/schema.md`), which the API sets:
    - a detailed level sets `roastLevel` from the mapping; a `roastLevel`
      sent with it that doesn't match is a `400`;
    - clearing a stored `detailedRoastLevel` (sending `null`) clears
      `roastLevel` too, unless the same body sends one; a `null` for a bean
      that has no detailed level leaves `roastLevel` as it is;
    - `roastLevel` can be set on its own only while the bean has no
      detailed level (older beans and clients).
  - `blendType`: one of `BLEND_TYPES` (`single_origin`, `blend`, `other`).
  - `decaf`: boolean, default `false`.
  - `website`: an `http` or `https` URL, ≤500 chars (blank becomes `null`).
  - `priceAmount` (> 0, ≤2 decimals) and `priceCurrency` (ISO 4217 code,
    3 letters, uppercased): the price of one bag, both or neither. On `PATCH`
    the rule applies to the bean after the change.
  - `bagWeightGrams`: integer 1–100000. With a price, clients show a price
    per gram; it isn't stored.
  - `notes`: free text, ≤2000 chars.
  - `flavorProfile`: the roaster's tasting notes, free text, ≤500 chars.
  - `originArea`: where it was grown, one of `ORIGIN_AREAS` (`africa`,
    `arabia`, `central_america`, `south_america`, `asia`, `pacific`).
    `central_america` includes Mexico and the Caribbean.
  - `country`: free text, ≤100 chars; a blend may list several. Clients
    may suggest countries and fill in `originArea` from them; the API
    doesn't check that the two agree.
  - `region` (the growing area within the country, e.g. `Yirgacheffe`) and
    `producer` (farm, co-op or washing station): free text, ≤255 chars each.
  - `altitudeMasl`: integer 0–9000, metres above sea level. Clients may
    show it in feet (docs/backlog.md item 3); it's always stored in metres.
  - `purchaseDate`: `YYYY-MM-DD`, at most one day after the server's date.
  - `greenSupplier`: who sold the green coffee, free text, ≤255 chars.
  - `rating`: the bean overall, integer 1–5.
- **Success (`201 Created`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid body, a price without its currency (or the
  reverse), or a `roastLevel` that contradicts the detailed level; `403`
  viewer.

## `PATCH /api/workspaces/:workspaceId/beans/:beanId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields, with the same rules.
  Unknown fields are rejected. `process`, `roastLevel`, `roastDate` and every
  optional detail except `decaf` can be set to `null`.

  Also `"archived": true | false`, like a grinder's `archived` (§3b). `true`
  sets `archivedAt` to now (unchanged if already archived); `false` restores
  the bean. It can go with other fields, e.g.
  `{ "archived": true, "rating": 4 }` when a bean is rated as it's archived.
  Archived beans leave the public menu (§7).

  > **Frontend (rating prompt):** archiving a bean with no `rating` first asks
  > for one (stars, **Rate and archive** or **Skip rating**). Archived beans
  > that are still unrated are listed on the Archived tab with a **Rate**
  > button until they're rated.
- **Success (`200 OK`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid or empty body; `403` viewer; `404` bean not in this
  workspace.

## `DELETE /api/workspaces/:workspaceId/beans/:beanId`

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
> 12 brew logs and their AI suggestions. Consider archiving it instead."*,
> with actions **Cancel**, **Archive instead** (`PATCH` `archived: true`; for
> a bean that's already archived, **Hide instead**, `showOnPublicMenu: false`)
> and **Delete everything** (retry with `?deleteBrewLogs=true`). Never send `deleteBrewLogs=true`
> without the user confirming that dialog.

## `POST /api/workspaces/:workspaceId/beans/:beanId/freeze`

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

## `POST /api/workspaces/:workspaceId/beans/:beanId/thaw`

Ends the open freeze period.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "date": "2026-10-20" }` (optional, same as freeze)
- **Rules:** the date can't be before that period's `frozenOn`, or more than
  one day after the server's current date.
- **Success (`200 OK`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid date or rule broken; `403` viewer; `404` bean not
  in this workspace; `409` not frozen.

## `PATCH /api/workspaces/:workspaceId/beans/:beanId/freezes/latest`

Corrects the latest freeze period: the open one, else the one thawed last
(periods never overlap). Ages everywhere, including the AI's, are worked out
from the periods, so a correction applies to past brews too.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "frozenOn"?: "2026-10-03", "thawedOn"?: "2026-10-10" | null }`
  (at least one). `thawedOn: null` un-thaws: the bean is frozen again from
  the same period.
- **Rules:** `frozenOn` can't be before the roast date or the previous
  period's `thawedOn`; `thawedOn` can't be before `frozenOn`; neither can be
  more than one day after the server's current date.
- **Success (`200 OK`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid body or rule broken; `403` viewer; `404` bean not
  in this workspace, or it has no freeze periods.

## `DELETE /api/workspaces/:workspaceId/beans/:beanId/freezes/latest`

Deletes the latest freeze period (e.g. a freeze recorded by mistake); its
days count toward the roast age again. The period before it, if any, becomes
the latest.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`200 OK`):** `{ "bean": { ...bean } }`
- **Errors:** `403` viewer; `404` bean not in this workspace, or no periods.
