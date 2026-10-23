# 3d. Prep Tools

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

An ordered list per workspace (Bar setup → Tools) of the prep a brew can use:
WDT, a puck screen, a rinsed paper filter… Brew logs record the tools used
(§6) and the AI analysis gets their names (§9). The brew form lists them as
a checklist in this order, showing a recipe's method's tools and the
all-method ones.

**Tool object:**

```json
{ "id": "uuid", "name": "Puck screen", "methodKind": "espresso", "position": 2, "retiredAt": null, "createdAt": "…" }
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

A **retired** tool (`retiredAt` set) leaves the checklist for new brews, but
past brews keep showing it, and it can be restored. A tool that brews used
can't be deleted (retire it instead); an unused one can.

## `GET /api/workspaces/:workspaceId/prep-tools`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "tools": [ { ...tool } ] }` by `position`,
  retired ones included.

## `POST /api/workspaces/:workspaceId/prep-tools`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Melodrip", "methodKind": "filter" }` (`methodKind`
  optional, nullable). It goes last.
- **Success (`201 Created`):** `{ "tool": { ...tool } }`
- **Errors:** `400`; `403` viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/prep-tools/:toolId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of `name`, `methodKind`, and
  `"retired": true | false` (`true` sets `retiredAt`, unchanged if already
  retired; `false` restores it).
- **Success (`200 OK`):** `{ "tool": { ...tool } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `PUT /api/workspaces/:workspaceId/prep-tools/order`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "toolIds": ["uuid", "uuid"] }`: every tool of the workspace,
  retired ones included, exactly once, in the new order.
- **Success (`200 OK`):** `{ "tools": [ { ...tool } ] }`
- **Errors:** `400` not exactly the workspace's tools; `403` viewer.

## `DELETE /api/workspaces/:workspaceId/prep-tools/:toolId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` brews used it,
  with body `{ "error": "...", "brewLogCount": 3 }`. Retire it instead.
