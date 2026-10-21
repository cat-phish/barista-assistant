# 5d. Drink Categories

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

An ordered list per workspace that groups drinks and brewers: the first
choice when brewing (Category → Brewer or drink → Recipe), and the public
menu's sections ("Espresso milk drinks", "Specialty drinks").

**Category object:** `{ "id": "uuid", "name": "Specialty drinks", "position": 2 }`

## `GET /api/workspaces/:workspaceId/drink-categories`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "categories": [ { ...category } ] }`, by `position`.

## `POST /api/workspaces/:workspaceId/drink-categories`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Specialty drinks" }` (trimmed, 1–100 chars, unique
  per workspace, case-insensitive). It goes last.
- **Success (`201 Created`):** `{ "category": { ...category } }`
- **Errors:** `400`; `403` viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/drink-categories/:categoryId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "..." }`
- **Success (`200 OK`):** `{ "category": { ...category } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `PUT /api/workspaces/:workspaceId/drink-categories/order`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "categoryIds": ["uuid", "uuid"] }`: every category of the
  workspace exactly once, in the new order.
- **Success (`200 OK`):** `{ "categories": [ { ...category } ] }`
- **Errors:** `400` not exactly the workspace's categories; `403` viewer.

## `DELETE /api/workspaces/:workspaceId/drink-categories/:categoryId`

Drinks and brewers in it become uncategorised.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
