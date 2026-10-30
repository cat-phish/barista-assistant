# 4e. Green Coffees

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Home roasting (workspace setting `homeRoasting`, §2): the green (unroasted)
coffee a workspace has bought to roast, and how much is left. The app shows
it in roast mode under **Green**. The origin fields are a bean's (§4), so a
roast (§4f) copies them onto the bean it makes, and takes its green weight
off `weightLeftGrams`.

**Green coffee object:**

```json
{
  "id": "uuid",
  "name": "Ethiopia Guji Hambela",
  "originArea": "africa",
  "country": "Ethiopia",
  "region": "Guji",
  "producer": "Hambela Estate",
  "altitudeMasl": 2100,
  "varieties": ["74110", "74112"],
  "species": ["arabica"],
  "processId": "uuid",
  "supplier": "Sweet Maria's",
  "lot": "ETH-2026-14",
  "priceAmount": 42.5,
  "priceCurrency": "USD",
  "weightBoughtGrams": 2270,
  "weightLeftGrams": 1810,
  "lowStockGrams": 500,
  "purchaseDate": "2026-10-01",
  "notes": null,
  "archivedAt": null,
  "createdAt": "2026-10-01T09:00:00.000Z"
}
```

Only `name` is required; the rest are `null` when unknown.

| Field | Values |
|---|---|
| `name` | trimmed, 1–255 chars, unique in the workspace (case-insensitive) |
| `originArea`, `country`, `region`, `producer`, `altitudeMasl`, `varieties`, `species` | as on a bean (§4): `varieties` and `species` each entry once, `[]` stored as `null` |
| `processId` | one of the workspace's bean processes (§4b), or `null`; deleting the process sets it to `null` |
| `supplier` | text, ≤ 255 chars |
| `lot` | the supplier's lot or reference, ≤ 100 chars |
| `priceAmount`, `priceCurrency` | what the whole purchase cost: both or neither, as on a bean (§4) |
| `weightBoughtGrams` | integer 1–1000000 |
| `weightLeftGrams` | integer 0–1000000, never `null`. On `POST` it defaults to `weightBoughtGrams` (or `0`) |
| `lowStockGrams` | integer ≥ 1, or `null` for never: below it the stock shows as low |
| `purchaseDate` | `YYYY-MM-DD`, not in the future (a day ahead is allowed, for time zones) |
| `notes` | text, ≤ 2000 chars |

Text fields are trimmed, and blank becomes `null`. Optional fields can be
hidden in the app (`green.*` keys in `hiddenFields`, §2 "Field visibility").
An **archived** green coffee (`archivedAt` set: used up, or not roasting it
now) leaves the pickers; it can be restored.

## `GET /api/workspaces/:workspaceId/green-coffees`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "greenCoffees": [ { ...greenCoffee } ] }`:
  active ones first, then archived; each sorted by `name`.

## `POST /api/workspaces/:workspaceId/green-coffees`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "…", ...fields }`
- **Success (`201 Created`):** `{ "greenCoffee": { ...greenCoffee } }`
- **Errors:** `400` invalid body, a price without its currency (or the other
  way round), or a process from another workspace; `403` viewer; `409` name
  taken.

## `PATCH /api/workspaces/:workspaceId/green-coffees/:greenId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields plus
  `"archived": true | false`. The price rule is checked with the change
  applied to what's stored.
- **Success (`200 OK`):** `{ "greenCoffee": { ...greenCoffee } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `GET /api/workspaces/:workspaceId/green-coffees/:greenId/usage`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "roastCount": 3 }`: the roasts of it.
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/green-coffees/:greenId`

Roasts of it keep their record (and their beans) with `greenCoffeeId` set
to `null`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
