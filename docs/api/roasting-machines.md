# 3f. Roasting Machines

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Home roasting (workspace setting `homeRoasting`, §2): the machines a
workspace roasts on. Roasts (coming with the roast log, docs/backlog.md
item 15) will record which one was used. The app shows them in roast mode
under **Roasters**.

**Roasting machine object:**

```json
{
  "id": "uuid",
  "name": "Kaffelogic Nano 7",
  "notes": "Firmware 7.4",
  "capacityGrams": 120,
  "archivedAt": null,
  "createdAt": "2026-10-28T09:00:00.000Z"
}
```

| Field | Values |
|---|---|
| `name` | trimmed, 1–100 chars, unique in the workspace (case-insensitive) |
| `notes` | optional text, ≤ 255 chars, blank becomes `null` |
| `capacityGrams` | optional, the largest batch of green coffee, integer 1–100000 |

`createdAt` (read-only) is when it was added. An **archived** machine
(`archivedAt` set) leaves the pickers but history keeps it, like grinders
(§3b). The routes don't depend on `homeRoasting`: turning it off only hides
roast mode in the app.

## `GET /api/workspaces/:workspaceId/roasting-machines`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "machines": [ { ...machine } ] }`: active ones
  first, then archived; each sorted by `name`.

## `POST /api/workspaces/:workspaceId/roasting-machines`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Kaffelogic Nano 7", "notes": "…", "capacityGrams": 120 }`
  (only `name` required)
- **Success (`201 Created`):** `{ "machine": { ...machine } }`
- **Errors:** `400` invalid body; `403` viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/roasting-machines/:machineId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields plus
  `"archived": true | false` (`true` keeps the first archive date; `false`
  restores it).
- **Success (`200 OK`):** `{ "machine": { ...machine } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `GET /api/workspaces/:workspaceId/roasting-machines/:machineId/usage`

What deleting it would affect (see README, "Deleting").

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "roastCount": 0 }`: the roasts made on it.
  Always `0` until roasts are logged.
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/roasting-machines/:machineId`

Roasts made on it will keep their record with the machine unlinked.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
