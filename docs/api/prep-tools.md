# 3d. Prep Tools

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

An ordered list per workspace (Bar setup → Tools) of the prep a brew can use:
WDT, a puck screen, a rinsed paper filter… Brew logs record the tools used
(§6) and the AI analysis gets their names (§9). The brew page lists them as
a checklist in this order, showing a recipe's method's tools and the
all-method ones: on setup above Start, to tick while getting ready, and on
the log form with the same ticks, to change afterwards.

**Tool object:**

```json
{ "id": "uuid", "name": "Puck screen", "methodKind": "espresso", "position": 2, "archivedAt": null, "createdAt": "…" }
```

- `name`: trimmed, 1–100 chars, unique per workspace (case-insensitive).
- `methodKind`: the method it's for (`filter`, `espresso`, `stovetop`,
  `other`), or `null` for every method.
- `position`: 1, 2, 3… (the checklist order).

A new workspace starts with `DEFAULT_PREP_TOOLS` (`docs/schema.md`): WDT,
Puck screen, Distributor, Shaker, Bottom paper filter and Top paper filter
(espresso); Rinsed paper filter, Metal filter and Cloth filter (filter); RDT
and Sifted fines (every method). Migration 0038 gave existing workspaces the
same list.

An **archived** tool (`archivedAt` set) leaves the checklist for new brews, but
past brews keep showing it, and it can be restored. Deleting one takes it off
the brews that used it (see `DELETE` below).

## `GET /api/workspaces/:workspaceId/prep-tools`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "tools": [ { ...tool } ] }` by `position`,
  archived ones included.

## `POST /api/workspaces/:workspaceId/prep-tools`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Melodrip", "methodKind": "filter" }` (`methodKind`
  optional, nullable). It goes last.
- **Success (`201 Created`):** `{ "tool": { ...tool } }`
- **Errors:** `400`; `403` viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/prep-tools/:toolId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of `name`, `methodKind`, and
  `"archived": true | false` (`true` sets `archivedAt`, unchanged if already
  archived; `false` restores it).
- **Success (`200 OK`):** `{ "tool": { ...tool } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `PUT /api/workspaces/:workspaceId/prep-tools/order`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "toolIds": ["uuid", "uuid"] }`: every tool of the workspace,
  archived ones included, exactly once, in the new order.
- **Success (`200 OK`):** `{ "tools": [ { ...tool } ] }`
- **Errors:** `400` not exactly the workspace's tools; `403` viewer.

## `GET /api/workspaces/:workspaceId/prep-tools/:toolId/usage`

What deleting it would take with it (see README, "Deleting").

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewLogCount": 3 }`: brews that used it.
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/prep-tools/:toolId`

Brews that used it are kept, without it in their `tools`. Clients warn first,
from `/usage`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
