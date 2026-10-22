# 5c. Drinks

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

What's served, and what the public menu (§7) lists alongside plain brews. A
drink needs a **brew method** (`kind`, one of `METHOD_KINDS`: `filter`,
`espresso`, `stovetop` or `other`), not a
particular device: **any brewer of that kind** can make it, with that
brewer's recipes (the **default**, any recipe of the kind, is preselected
when brewing), then it's finished with **ingredients**. "Latte" is espresso
plus steamed milk, on any espresso machine; "The Atlas" is pour over plus
orange cold foam, on a V60 or a Chemex. The plain brew ("V60") isn't
a drink: it's the brewer itself (§3).

A drink can be a **variant** of another drink (`parentDrinkId`), like a
cocktail riff: Vanilla Latte is a variant of Latte, and Iced Vanilla Latte a
variant of Vanilla Latte. A variant is a complete, independent drink (clients
create one by copying the parent); nothing is inherited after that. Its
kind may differ from its parent's.

**Drink object:**

```json
{
  "id": "uuid",
  "name": "Vanilla Latte",
  "description": null,
  "kind": "espresso",
  "category": { "id": "uuid", "name": "Espresso milk drinks" },
  "parent": { "id": "uuid", "name": "Latte" },
  "variants": [{ "id": "uuid", "name": "Iced Vanilla Latte" }],
  "defaultRecipeId": "uuid",
  "servingSize": 8,
  "servingUnit": "fl_oz",
  "instructions": "Add the syrup to the cup and pull the shot onto it.\nSteam the milk and pour.",
  "createdAt": "2026-10-20T15:30:00.000Z",
  "ingredients": [
    { "ingredientId": "uuid", "name": "Steamed milk", "ingredientType": "milk", "amountValue": 6, "amountUnit": "fl oz", "note": null },
    { "ingredientId": "uuid", "name": "Vanilla syrup", "ingredientType": "syrup", "amountValue": 2, "amountUnit": "pump", "note": "in the milk" }
  ]
}
```

`createdAt` is when the drink was added (read-only; lists sort by it).
`servingSize` + `servingUnit` (`SERVING_UNITS`: `fl_oz`, `ml`) are the
drink's default size, or both `null`. Ingredient amounts are for that size;
clients scale them when a brew is made bigger or smaller (and, for a filter
brewer, the coffee batch too; an espresso shot stays as the recipe says).

`category` and `parent` are `null` when not set; `variants` (direct children
only) are sorted by name; `ingredients` are in their order. `defaultRecipeId`
is a recipe whose brewer is of the drink's kind, or `null` (none set, or it
was deleted).

## `GET /api/workspaces/:workspaceId/drinks`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "drinks": [ { ...drink } ] }`, sorted by `name`.

## `POST /api/workspaces/:workspaceId/drinks`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:**
  ```json
  {
    "name": "Vanilla Latte",
    "description": null,
    "kind": "espresso",
    "categoryId": "uuid",
    "parentDrinkId": "uuid",
    "defaultRecipeId": "uuid",
    "servingSize": 8,
    "servingUnit": "fl_oz",
    "instructions": "Add the syrup to the cup and pull the shot onto it.\nSteam the milk and pour.",
    "ingredients": [{ "ingredientId": "uuid", "amountValue": 2, "amountUnit": "pump", "note": null }]
  }
  ```
  - `name` trimmed, 1–255 chars; `description` optional, ≤ 500, blank
    becomes `null`; the menu shows it unless the menu builder (§7b) gives the
    item its own. What's on the menu is set in the builder. Unknown fields
    are rejected, including the removed `showOnPublicMenu`.
  - `instructions` (optional, ≤ 5000, blank becomes `null`): how to make it,
    free text shown after the brew. Not on the public menu.
  - `kind` (required): one of `METHOD_KINDS`.
  - `categoryId` (optional, nullable): a drink category (§5d) in this workspace.
  - `parentDrinkId` (optional, nullable): another drink in this workspace.
  - `defaultRecipeId` (optional, nullable): a recipe in this workspace on a
    brewer of that kind.
  - `servingSize` (> 0, ≤ 2000, 1 decimal) and `servingUnit` (`fl_oz` or
    `ml`): optional, nullable, both or neither.
  - `ingredients` (default `[]`, max 20, in order): each `ingredientId` a
    ingredient in this workspace (at most once). All optional and nullable:
    `amountValue` (> 0, ≤ 100000, 2 decimals); `amountUnit` (trimmed, ≤ 20,
    blank becomes `null`; free text, clients offer `fl oz`, `ml`, `g` plus
    the units already used); `note` ≤ 255 chars, blank becomes `null`. A unit
    without a value ("to taste") doesn't scale.
- **Success (`201 Created`):** `{ "drink": { ...drink } }`
- **Errors:** `400` invalid body, a category/parent/recipe/ingredient not in
  this workspace, or a default recipe of another kind; `403` viewer.

## `PATCH /api/workspaces/:workspaceId/drinks/:drinkId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields. `ingredients`, if
  present, replaces the list. Changing `brewerId` without sending a matching
  `defaultRecipeId` clears a default of the old kind.
- **Success (`200 OK`):** `{ "drink": { ...drink } }`
- **Errors:** as `POST`, plus `400` when `parentDrinkId` is the drink itself
  or one of its variants (at any depth); `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/drinks/:drinkId`

Its variants move up to its own parent (or become top-level drinks). Brew
logs made for it are kept, with `drinkId` set to `null`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
