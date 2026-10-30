# 4f. Roasts

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Home roasting (workspace setting `homeRoasting`, §2): the roast log. A roast
is one batch: which green coffee (§4e) and how much went in, what came out,
and the roast's temperatures and times. **Saving a roast creates its bean**
(§4), ready to brew, and takes the green weight off the green coffee's stock.
The app shows roasts in roast mode under **Roast** (the form) and
**Roasts** (the history).

**Roast object:**

```json
{
  "id": "uuid",
  "greenCoffeeId": "uuid",
  "greenCoffee": { "id": "uuid", "name": "Ethiopia Guji", "weightLeftGrams": 380, "lowStockGrams": 500 },
  "machineId": "uuid",
  "machine": { "id": "uuid", "name": "Nano 7" },
  "beanId": "uuid",
  "bean": { "id": "uuid", "inventoryWeightGrams": 85, "archived": false },
  "userId": "uuid",
  "roastedAt": "2026-10-21T06:30:00.000Z",
  "utcOffsetMinutes": -420,
  "batchNumber": "3",
  "greenGrams": 120,
  "roastedGrams": 102,
  "greenStockTakenGrams": 120,
  "roastType": "filter",
  "detailedRoastLevel": "city_plus",
  "roastLevel": "medium",
  "chargeTempC": 210.5,
  "dropTempC": 205,
  "firstCrackSec": 450,
  "totalSec": 560,
  "restDays": 7,
  "notes": null,
  "createdAt": "2026-10-21T06:45:00.000Z"
}
```

| Field | Values |
|---|---|
| `greenCoffeeId` | required on `POST`: one of the workspace's green coffees (archived ones too). `null` once that green coffee is deleted |
| `machineId` | optional, one of the workspace's roasting machines (§3f) |
| `roastedAt`, `utcOffsetMinutes` | when it was roasted (default now; at most 5 minutes ahead), and the device's UTC offset, as on brews (§6): together they give the local roast date |
| `batchNumber` | text ≤ 50. Left out on `POST`, it's the next batch of this green coffee: one more than its highest numbered roast |
| `greenGrams`, `roastedGrams` | required integers 1–100000: green in, roasted out. `roastedGrams` is less than `greenGrams`, and at most 40% is lost |
| `roastType` | `filter`, `espresso` or `omni` (`ROAST_TYPES`) |
| `detailedRoastLevel`, `roastLevel` | as on a bean (§4): a detailed level sets the 5-step level |
| `chargeTempC`, `dropTempC` | 0–350 °C, 1 decimal |
| `firstCrackSec`, `totalSec` | seconds from the charge, 1–5999; first crack before the end. Development time is `totalSec − firstCrackSec` |
| `restDays` | 0–60. Left out on `POST`, the workspace's `restDays` for its roast type (omni when the type isn't set). It's ready on the local roast date + `restDays` |
| `notes` | text ≤ 2000 |

Read-only: `beanId` (the bean it made; `null` once that bean is deleted),
`userId` (who logged it), `greenStockTakenGrams` (what it took off the green
coffee's `weightLeftGrams`: never more than was left, so a roast logged with
no stock recorded takes nothing), `greenCoffee` (name and what's left of it
now, with its threshold) and `machine` (name), each `null` once deleted, and
`bean` (what's left of the bean it made, and whether it's archived; `null`
once deleted).

**Resting:** a roast is ready on its local roast date + `restDays`. Roast
mode's **Resting** tab lists the roasts still resting, soonest ready first,
then the ready ones whose bean is still in use (there, not archived, some
left), latest ready first. The bean shows **Resting until …** until then
(`roastReadyOn`, §4). A roast's page says when its green coffee is low or
used up.

**The bean it makes** (§4): roaster = the workspace's `homeRoasterName`; the
green coffee's name, process, origin, producer, altitude, varieties, species
and supplier (`greenSupplier`); the roast date (the local date), type, levels,
weight loss (`roastWeightLossPercent`), batch number; in stock and bag weight
= `roastedGrams`; and its price = this batch's share of the green coffee's
price (`priceAmount / weightBoughtGrams × greenGrams`), when both are known.
The bean is an ordinary bean after that: it can be edited, brewed, archived.

## `GET /api/workspaces/:workspaceId/roasts`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "roasts": [ { ...roast } ] }`, newest first.

## `GET /api/workspaces/:workspaceId/roasts/:roastId`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "roast": { ...roast } }`
- **Errors:** `404` not in this workspace.

## `POST /api/workspaces/:workspaceId/roasts`

Creates the roast and its bean, and takes up to `greenGrams` off the green
coffee's stock, in one transaction.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "greenCoffeeId": "uuid", "greenGrams": 120, "roastedGrams": 102, ...fields }`
- **Success (`201 Created`):** `{ "roast": { ...roast }, "restReminder": "queued" }`.
  `restReminder` (`queued`, `off` or `unavailable`, as a brew's `reminder`,
  §1b) is left out when the roast is ready already (no rest, or roasted
  long enough ago). Taking the green coffee below its `lowStockGrams` also
  sends the low-stock notice (§1b).
- **Errors:** `400` invalid body, weights that don't add up, first crack at
  or after the end, a roast level that disagrees with the detailed level, or
  a green coffee or machine from another workspace; `403` viewer.

## `PATCH /api/workspaces/:workspaceId/roasts/:roastId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields. The rules are checked
  with the change applied to what's stored.
- **The bean follows** (when it still exists): its roast date, type, levels,
  weight loss, batch and bag weight; its stock moves by the change in
  `roastedGrams` (never below 0), so what's been brewed stays used; with
  another green coffee, its coffee fields and price are that coffee's; with
  another green weight, its price follows.
- **The stock follows:** with another green coffee or green weight, what was
  taken goes back and the new amount is taken (again no more than is left).
- **The reminder follows:** with another `roastedAt`, `utcOffsetMinutes` or
  `restDays`, the rest reminder moves to the new ready day (or is dropped
  when it's ready now), and the reply has `restReminder`; other edits leave
  it be. An edit that takes the green coffee below its threshold sends the
  low-stock notice.
- **Success (`200 OK`):** `{ "roast": { ...roast }, "restReminder"?: … }`
- **Errors:** as `POST`; `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/roasts/:roastId`

Gives back `greenStockTakenGrams` to the green coffee and drops its rest
reminder. The bean stays, with its brews.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
