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
  A bean is frozen when its last period has `thawedOn: null`. Every endpoint
  that returns a bean includes `freezePeriods`.

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
    "process": "Washed",
    "roastLevel": "light",
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
    "notes": "Sweet and round. Roaster suggests 1:16."
  }
  ```
  `roasterName` and `beanName` are required (trimmed, 1–255 chars).
  `process` (≤100 chars), `roastLevel` (one of `ROAST_LEVELS`: `light`,
  `medium_light`, `medium`, `medium_dark`, `dark`) and `roastDate` (ISO date
  or datetime) are optional and nullable. `inventoryWeightGrams` is an integer ≥ 0 (default `0`).
  `showOnPublicMenu` defaults to `true`.

  Optional details, all nullable except `decaf`:
  - `roastType`: what it was roasted for, one of `ROAST_TYPES` (`filter`,
    `espresso`, `omni`); `null` = unknown.
  - `detailedRoastLevel`: one of `DETAILED_ROAST_LEVELS`, lightest to
    darkest: `cinnamon`, `american`, `new_england`, `half_city`,
    `modern_light`, `city`, `city_plus`, `full_city`, `full_city_plus`,
    `italian`, `vienna`, `french`. Each implies a `roastLevel`
    (`DETAILED_ROAST_TO_LEVEL` in `docs/schema.md`). The API stores both as
    sent; the bean form fills `roastLevel` when a detailed level is picked,
    and it can still be changed by hand.
  - `blendType`: one of `BLEND_TYPES` (`single_origin`, `blend`, `other`).
  - `decaf`: boolean, default `false`.
  - `website`: an `http` or `https` URL, ≤500 chars (blank becomes `null`).
  - `priceAmount` (> 0, ≤2 decimals) and `priceCurrency` (ISO 4217 code,
    3 letters, uppercased): the price of one bag, both or neither. On `PATCH`
    the rule applies to the bean after the change.
  - `bagWeightGrams`: integer 1–100000. With a price, clients show a price
    per gram; it isn't stored.
  - `notes`: free text, ≤2000 chars.
- **Success (`201 Created`):** `{ "bean": { ...bean } }`
- **Errors:** `400` invalid body, or a price without its currency (or the
  reverse); `403` viewer.

## `PATCH /api/workspaces/:workspaceId/beans/:beanId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields, with the same rules.
  Unknown fields are rejected. `process`, `roastLevel`, `roastDate` and every
  optional detail except `decaf` can be set to `null`.
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
> 12 brew logs and their AI suggestions. Consider hiding it from the menu or
> setting its inventory to 0 instead."*, with actions **Cancel**, **Hide
> instead** (`PATCH` `showOnPublicMenu: false`) and **Delete everything**
> (retry with `?deleteBrewLogs=true`). Never send `deleteBrewLogs=true`
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
