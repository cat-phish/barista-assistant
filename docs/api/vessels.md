# 3g. Vessels

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The carafes, mugs and cups a workspace weighs its brews in (Bar setup →
Vessels). There's no type: a vessel is a name and a weight. On the brew log,
**Weighed** beside the yield or shot weight says how it was weighed: directly,
or in a vessel, whose weight comes off the total (§6 `vesselId`).

**Vessel object:**

```json
{
  "id": "uuid",
  "name": "Glass carafe",
  "weightGrams": 312.5,
  "archivedAt": null,
  "createdAt": "2026-10-31T09:00:00.000Z"
}
```

| Field | Values |
|---|---|
| `name` | trimmed, 1–100 chars, unique in the workspace (case-insensitive) |
| `weightGrams` | required, > 0 and < 10000, max 2 decimals |

An **archived** vessel (`archivedAt` set) leaves the picker but history keeps
it, like grinders (§3b). Changing `weightGrams` changes no past brew: each
keeps the weight it subtracted (§6 `vesselWeightGrams`).

## `GET /api/workspaces/:workspaceId/vessels`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "vessels": [ { ...vessel } ] }`: active ones
  first, then archived; each sorted by `name`.

## `POST /api/workspaces/:workspaceId/vessels`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Glass carafe", "weightGrams": 312.5 }` (both required)
- **Success (`201 Created`):** `{ "vessel": { ...vessel } }`
- **Errors:** `400` invalid body; `403` viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/vessels/:vesselId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields plus
  `"archived": true | false` (`true` keeps the first archive date; `false`
  restores it).
- **Success (`200 OK`):** `{ "vessel": { ...vessel } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `GET /api/workspaces/:workspaceId/vessels/:vesselId/usage`

What deleting it would affect (see README, "Deleting").

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewLogCount": 3 }`: the brews weighed in it.
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/vessels/:vesselId`

Brews weighed in it keep their yield, with `vesselId` and `vesselWeightGrams`
set to `null`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
