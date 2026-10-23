# 5b. Ingredients

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Reusable preps that finish a drink: orange-infused cold foam, steamed oat
milk, vanilla syrup, ice. Per workspace.

**Ingredient object:**
`{ "id": "uuid", "name": "Orange cold foam", "ingredientType": "foam", "instructions": "Infuse cream with orange peel overnight…", "drinkCount": 2, "archivedAt": null, "createdAt": "2026-10-20T15:00:00.000Z" }`

- `ingredientType`: one of `INGREDIENT_TYPES` (`milk`, `foam`, `syrup`, `ice`,
  `water`, `other`; default `other`).
- `instructions`: free text, optional, ≤ 5000 chars, blank becomes `null`.
- `drinkCount`: how many drinks use it (read-only).
- `createdAt`: when it was added (read-only; lists sort by it).

## `GET /api/workspaces/:workspaceId/ingredients`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "ingredients": [ { ...ingredient } ] }`, sorted by `name`.

## `POST /api/workspaces/:workspaceId/ingredients`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Orange cold foam", "ingredientType": "foam", "instructions": "…" }`
  (`name` trimmed, 1–100 chars, unique per workspace, case-insensitive)
- **Success (`201 Created`):** `{ "ingredient": { ...ingredient } }`
- **Errors:** `400`; `403` viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/ingredients/:ingredientId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields, plus
  `"archived": true | false`, like a bean's (§4): `true` sets `archivedAt`
  (unchanged if already archived), `false` restores it. Clients don't offer
  archived ingredients when building a drink; drinks that have one keep it.
- **Success (`200 OK`):** `{ "ingredient": { ...ingredient } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `DELETE /api/workspaces/:workspaceId/ingredients/:ingredientId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` drinks use it,
  with body `{ "error": "...", "drinkCount": 2 }`. Remove it from those drinks first.
