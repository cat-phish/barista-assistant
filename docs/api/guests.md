# 2d. Guests

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The people a workspace brews for besides whoever logs the brew (Settings →
Guests; backlog 67). A guest is a name and notes. A brew names who it was
for (§6, "Who it's for"); their share of volume and caffeine counts in
Insights and recaps in a later phase of backlog 67.

A guest is **not linked** to a user: linking one to a member, so their share
counts in their own stats, waits for an invite that member accepts (backlog
67, "Later"). `linkedUserId` in a body is rejected as an unknown key.

**Guest object:**

```json
{
  "id": "uuid",
  "name": "Sam",
  "notes": "Oat milk, no sugar",
  "archivedAt": null,
  "createdAt": "2026-11-17T09:00:00.000Z"
}
```

| Field | Values |
|---|---|
| `name` | trimmed, 1–100 chars, unique in the workspace (case-insensitive) |
| `notes` | trimmed, up to 1000 chars; blank is `null` |

An **archived** guest (`archivedAt` set) leaves the picker but history keeps
it, like vessels (§3g).

## `GET /api/workspaces/:workspaceId/guests`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "guests": [ { ...guest } ] }`: active ones
  first, then archived; each sorted by `name`.

## `POST /api/workspaces/:workspaceId/guests`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Sam", "notes": "Oat milk" }` (`name` required)
- **Success (`201 Created`):** `{ "guest": { ...guest } }`
- **Errors:** `400` invalid body; `403` viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/guests/:guestId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields plus
  `"archived": true | false` (`true` keeps the first archive date; `false`
  restores it).
- **Success (`200 OK`):** `{ "guest": { ...guest } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `GET /api/workspaces/:workspaceId/guests/:guestId/usage`

What deleting it would affect (see README, "Deleting").

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewLogCount": 3 }`, the brews made for them.
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/guests/:guestId`

- **Auth Required:** `true` (role `owner` or `barista`)
- Brews made for them keep a drinker in their place: each counts one more
  unnamed guest (§6), so the volume split doesn't change.
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
