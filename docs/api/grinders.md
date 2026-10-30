# 3b. Grinders

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

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
  "variableSpeed": false,
  "rpmMin": null,
  "rpmMax": null,
  "archivedAt": null,
  "createdAt": "2026-10-18T09:00:00.000Z"
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
| `variableSpeed` | boolean, default `false` (never `null`): the motor's speed can be set, so brews record it (`grindRpm`, §6) |
| `rpmMin`, `rpmMax` | the speed range, integers 50–5000; both or neither, min < max, and only when `variableSpeed` is `true` |

The range and step size are sent to the AI analysis so its reasoning can talk
in steps ("2 clicks finer"), and the speed range so it can suggest a speed;
the rest is reference.

`createdAt` (read-only) is when the grinder was added; lists sort by it.

An **archived** grinder (`archivedAt` set) is hidden from pickers for new brews,
but past brews keep showing it, and it can be restored. Deleting one unlinks
the brews made with it (see `DELETE` below).

## `GET /api/workspaces/:workspaceId/grinders`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "grinders": [ { ...grinder } ] }`: active ones
  first, then archived; each sorted by `name`.

## `POST /api/workspaces/:workspaceId/grinders`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Comandante C40", ...details }` (`name` trimmed,
  1–100 chars; the details from the table above, all optional and nullable)
- **Success (`201 Created`):** `{ "grinder": { ...grinder } }`
- **Errors:** `400` invalid body; `403` viewer; `409` a grinder with that name
  already exists in this workspace (case-insensitive).

## `PATCH /api/workspaces/:workspaceId/grinders/:grinderId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields plus
  `"archived": true | false`. `archived: true` sets `archivedAt` to now
  (unchanged if already archived); `false` restores it. The range is a pair:
  send both ends, or `null` for either to clear both; the RPM range works
  the same way. Setting `variableSpeed: false` clears the RPM range, and a
  range sent alone needs the grinder to already be variable speed (`400`
  otherwise). Brews keep the RPM they recorded.
- **Success (`200 OK`):** `{ "grinder": { ...grinder } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `GET /api/workspaces/:workspaceId/grinders/:grinderId/usage`

What deleting it would take with it (see README, "Deleting").

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewLogCount": 12, "recipeCount": 2 }`: brews made with it, and recipes with a grind setting for it or it as their default grinder.
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/grinders/:grinderId`

Brews made with it are kept, with `grinderId` set to `null` (their grind
setting text stays); recipes lose their grind setting for it, and it as their
default grinder. Clients warn first, from `/usage`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.

## `GET /api/workspaces/:workspaceId/grinders/:grinderId/last-setting?recipeId=<id>`

The grind setting of the most recent brew made with this grinder **and** this
recipe. The brew flow uses it to pre-fill the grind when both are chosen.

- **Auth Required:** `true` (any member)
- **Query:** `recipeId` (required).
- **Success (`200 OK`):**
  `{ "lastSetting": { "grindSetting": 20, "grindRpm": 900, "timestamp": "…", "brewLogId": "uuid" } | null }`
  (`grindRpm` is that brew's speed, or `null`).
  It's the newest such brew that has a grind setting (brews without one are
  skipped), or `null` if there's none.
- **Errors:** `400` missing/invalid `recipeId`; `404` grinder not in this
  workspace.
