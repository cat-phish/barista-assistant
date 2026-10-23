# 3c. Water Profiles

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Each workspace keeps its own list of brew waters (Bar setup → Water). Brew
logs record which one was used (§6), and the AI analysis gets its figures
(§9), since minerals change extraction.

**Water profile object:**

```json
{
  "id": "uuid",
  "name": "Third Wave Water (classic)",
  "notes": "1 sachet per gallon of distilled",
  "isDefault": true,
  "tdsPpm": 150,
  "generalHardnessPpm": 102,
  "alkalinityPpm": 0,
  "calciumPpm": 30,
  "magnesiumPpm": null,
  "sodiumPpm": null,
  "potassiumPpm": null,
  "bicarbonatePpm": null,
  "chloridePpm": null,
  "sulfatePpm": null,
  "ph": null,
  "archivedAt": null,
  "createdAt": "2026-10-22T09:00:00.000Z"
}
```

Everything after `name` is optional (`null` when unknown):

| Field | Values |
|---|---|
| `notes` | text, ≤ 255 chars, blank becomes `null` |
| `isDefault` | boolean, default `false`. At most one per workspace: setting it on one profile clears it on the others. New brews start on the default |
| `tdsPpm` | total dissolved solids, mg/L |
| `generalHardnessPpm` | GH, mg/L as CaCO3 |
| `alkalinityPpm` | KH (carbonate hardness, buffer), mg/L as CaCO3 |
| `calciumPpm`, `magnesiumPpm`, `sodiumPpm`, `potassiumPpm`, `bicarbonatePpm`, `chloridePpm`, `sulfatePpm` | each mineral, mg/L |
| `ph` | 0–14, 1 decimal |

Every mg/L figure is a number ≥ 0 and < 10000 with ≤ 2 decimals.

A **archived** profile (`archivedAt` set) is hidden from pickers for new brews,
but past brews keep showing it, and it can be restored. Archiving the default
clears `isDefault`, and an archived profile can't be made the default. A profile
that brews were logged with can't be deleted (archive it instead); an unused
one can.

## `GET /api/workspaces/:workspaceId/water-profiles`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "waterProfiles": [ { ...waterProfile } ] }`:
  active ones first, then archived; each sorted by `name`.

## `POST /api/workspaces/:workspaceId/water-profiles`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Tap", ...details }` (`name` trimmed, 1–100 chars;
  the details from the table above, all optional; the figures nullable)
- **Success (`201 Created`):** `{ "waterProfile": { ...waterProfile } }`
- **Errors:** `400` invalid body; `403` viewer; `409` a profile with that name
  already exists in this workspace (case-insensitive).

## `PATCH /api/workspaces/:workspaceId/water-profiles/:waterProfileId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields plus
  `"archived": true | false`. `archived: true` sets `archivedAt` to now
  (unchanged if already archived) and clears `isDefault`; `false` restores it.
  `"isDefault": true` makes it the workspace's only default.
- **Success (`200 OK`):** `{ "waterProfile": { ...waterProfile } }`
- **Errors:** `400` invalid body, or `isDefault: true` for a profile that is
  (or would stay) archived; `403` viewer; `404` not in this workspace; `409`
  name taken.

## `DELETE /api/workspaces/:workspaceId/water-profiles/:waterProfileId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` brews were
  logged with it, with body `{ "error": "...", "brewLogCount": 12 }`. Archive
  it instead.
