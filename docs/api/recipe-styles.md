# 5e. Recipe Styles

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

How a recipe brews, as the workspace's own list per brewer method (Settings →
Lists). Every workspace starts with the built-ins (`STYLES_BY_KIND` and
`STYLE_NAMES` in `docs/schema.md`):

| Method | Built-in styles |
|---|---|
| `filter` | Pour over, Immersion, Hybrid, Cold brew, Rapid cold brew, Kyoto drip, Other |
| `espresso` | Standard, Soup, Other |
| `stovetop` | Moka, Ibrik, Other |
| `other` | Other |

A recipe points at one with `styleId` (§5); it must be a style for its
brewer's method.

- **Brews like:** every style has `brewsLike`, the built-in it brews like
  (itself for a built-in). A custom style picks one of its method's
  built-ins, e.g. "Inverted" brews like `immersion`, "Turbo shot" like
  `standard`. Extraction yield (§6) and the AI (§9) go by `brewsLike`, so a
  custom style is worked out and judged as what it is.
- **Cold styles** change more than the label, by what they brew like
  (`LONG_STYLES`, `COLD_STYLES`):

  | Brews like | Brewed | Extraction yield from | Recipe adds (§5) |
  |---|---|---|---|
  | `cold_brew` | **long**: Start steep, Finish later (no timer) | the water (immersion) | steep window in hours, fridge/room, dilution |
  | `kyoto_drip` | **long**: as cold brew | the measured yield (percolation) | as cold brew |
  | `rapid_cold` | the normal timer, in minutes (e.g. an OXO Rapid Brewer) | the water (immersion) | dilution |

  A long style's recipe steps are a checklist (`advance: tap`, no times).
  Rapid cold brew and Kyoto drip were added in migration 0057, after each
  workspace's last filter style. A workspace that already had a style of
  that name kept its own.
- **Built-ins** keep their `builtin` key and always brew like themselves.
  They can be renamed and hidden, not deleted.
- **Hidden** styles are left out of the recipe form's choices; recipes that
  already have one keep it.
- **Custom** styles (`builtin: null`) can be deleted; their recipes lose
  the style.

**Style object:**
`{ "id": "uuid", "kind": "filter", "name": "Inverted", "position": 6, "hidden": false, "builtin": null, "brewsLike": "immersion" }`

Recipes and brew logs carry a recipe's style as `{ "id", "name", "brewsLike" }`
(or `null`).

## `GET /api/workspaces/:workspaceId/recipe-styles`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "styles": [ { ...style } ] }`: by method
  (filter, espresso, stovetop, other), then `position`; hidden ones included.

## `POST /api/workspaces/:workspaceId/recipe-styles`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "kind": "filter", "name": "Inverted", "brewsLike": "immersion" }`.
  `name`: trimmed, 1–100 chars, unique per workspace and method
  (case-insensitive). `brewsLike`: one of that method's built-in keys. It
  goes last in its method.
- **Success (`201 Created`):** `{ "style": { ...style } }`
- **Errors:** `400` (including a `brewsLike` from another method); `403`
  viewer; `409` name taken for that method.

## `PATCH /api/workspaces/:workspaceId/recipe-styles/:styleId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of `{ "name", "hidden", "brewsLike" }`.
  `brewsLike` only changes on a custom style, within its method; `kind` and
  `builtin` can't be changed.
- **Success (`200 OK`):** `{ "style": { ...style } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `PUT /api/workspaces/:workspaceId/recipe-styles/order`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "kind": "espresso", "styleIds": ["uuid", …] }`: every style
  of that method exactly once, in the new order.
- **Success (`200 OK`):** `{ "styles": [ { ...style } ] }`
- **Errors:** `400` not exactly the method's styles; `403` viewer.

## `GET /api/workspaces/:workspaceId/recipe-styles/:styleId/usage`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "recipeCount": 2 }`
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/recipe-styles/:styleId`

Custom styles only. Its recipes lose the style (`styleId` becomes `null`).

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` a built-in
  (hide it instead).

> **Frontend requirement:** load the usage first; when recipes use it, list
> them and require "I understand" before deleting (CLAUDE.md rule 7).
