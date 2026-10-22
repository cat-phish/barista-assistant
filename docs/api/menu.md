# 7b. Menu Builder

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The public menu (§7), arranged by hand. It's separate from drink categories
(§5d), which only group drinks on the brew page. A menu is a list of
**sections** you name and order. Each section holds **items** in order:

- a **drink** (§5c);
- a **brewer** (§3): its plain brew, e.g. "Espresso" for a Linea Mini;
- the **beans block**: the bar's active (not archived) beans whose
  `showOnPublicMenu` is on (§4), listed where you place it. At most one per
  menu.

An item can rename and describe its source for the menu (`name`,
`description`; `null` = the source's own), carry a `price` (in the menu's
`currency`), and be marked unavailable (`available: false`: still listed,
shown as unavailable). Each drink or brewer can be in a section once (it may
be in several sections). Deleting a drink or brewer removes its items; a
retired brewer stays in the builder (flagged) but is left off the public
menu.

All routes are under `/api/workspaces/:workspaceId/menu`. Any member can
read; writes need role `owner` or `barista`. Turning the public menu on or
off is the workspace's `isPublicMenuEnabled` (§2, owners only).

**Every route returns the whole menu** (`200`, or `201` for creates):

```json
{
  "currency": "USD",
  "sections": [
    {
      "id": "uuid",
      "name": "Espresso milk drinks",
      "description": null,
      "position": 1,
      "items": [
        {
          "id": "uuid",
          "itemType": "drink",
          "drinkId": "uuid",
          "brewerId": null,
          "name": "House latte",
          "description": null,
          "price": 5.5,
          "available": true,
          "source": { "name": "Latte", "description": "Double shot, steamed milk", "kind": "espresso", "retired": false }
        },
        {
          "id": "uuid", "itemType": "beans", "drinkId": null, "brewerId": null,
          "name": null, "description": null, "price": null, "available": true, "source": null
        }
      ]
    }
  ]
}
```

`source` is what the item shows by default: a drink's name and description,
or a brewer's name (brewers have no menu description; set one on the item).

## `GET /`

- **Errors:** `404` not a member.

## `PATCH /`

- **Body:** `{ "currency": "usd" | null }`: an ISO 4217 code (uppercased).
- **Errors:** `400` invalid, or `null` while items still have prices; `403`
  viewer.

## `POST /sections`

- **Body:** `{ "name": "Pour over", "description"?: "..." }`: name 1–100
  chars, unique per menu (case-insensitive); description ≤ 500. It goes last.
- **Errors:** `400`; `403` viewer; `409` name taken.

## `PATCH /sections/:sectionId`

- **Body:** any non-empty subset of `{ "name", "description" }`.
- **Errors:** `400`; `403`; `404` not in this menu; `409` name taken.

## `DELETE /sections/:sectionId`

Deletes the section and its items (not the drinks or brewers).

- **Errors:** `403`; `404`.

## `PUT /layout`

The whole arrangement at once, as a drag-and-drop or ↑/↓ editor has it: every
section of the menu exactly once, in the new order, each with its items in
order. Items can move between sections this way.

- **Body:** `{ "sections": [ { "id": "uuid", "itemIds": ["uuid", ...] } ] }`
- **Errors:** `400` a section or item missing, unknown or listed twice, or a
  drink or brewer twice in one section; `403`.

## `POST /sections/:sectionId/items`

- **Body:** `{ "itemType": "drink" | "brewer" | "beans", "drinkId"?, "brewerId"?,
  "name"?, "description"?, "price"?, "available"? }`. A drink item needs
  `drinkId` (and no `brewerId`), a brewer item `brewerId`, the beans block
  neither. `name` ≤ 255 and `description` ≤ 500 (blank = `null`); `price`
  0–999999.99, at most 2 decimals, and only once the menu has a `currency`;
  `available` defaults to `true`. It goes last in the section.
- **Errors:** `400` invalid body, a drink or brewer not in this workspace, or
  a price without a currency; `403`; `404` section not in this menu; `409`
  already in this section, or the menu already has the beans block.

## `PATCH /items/:itemId`

- **Body:** any non-empty subset of `{ "name", "description", "price",
  "available" }`, same rules. To move an item, use `PUT /layout`.
- **Errors:** `400`; `403`; `404`.

## `DELETE /items/:itemId`

- **Errors:** `403`; `404`.
