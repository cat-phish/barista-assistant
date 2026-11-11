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
  menu;
- an **other item** (see "Other items" below): a pastry, a bag of beans for
  sale, a special not written up yet, "ask about our decaf". Placed like a
  drink; it shows nothing under it (no method or ingredients).

An item can rename and describe its source for the menu (`name`,
`description`; `null` = the source's own), carry a `price` (in the menu's
`currency`), and be marked unavailable (`available: false`: still listed,
shown as unavailable). Each drink, brewer or other item can be in a section once (it may
be in several sections). Deleting a drink, brewer or other item removes its
items; a
archived brewer stays in the builder (flagged) but is left off the public
menu.

All routes are under `/api/workspaces/:workspaceId/menu`. Any member can
read; writes need role `owner` or `barista`. Turning the public menu on or
off is the workspace's `isPublicMenuEnabled` (§2, owners only).

**Every route returns the whole menu** (`200`, or `201` for creates):

```json
{
  "title": "The Brew Bar",
  "currency": "USD",
  "showMethod": true,
  "showIngredients": false,
  "accentColor": "#8a4b2a",
  "tagline": "Coffee, slowly",
  "logoId": "uuid",
  "logoIds": ["uuid", "uuid"],
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
          "source": { "name": "Latte", "description": "Double shot, steamed milk", "kind": "espresso", "method": "Espresso", "archived": false },
          "beanFields": null,
          "beanBatches": null,
          "showMethod": null,
          "showIngredients": true,
          "sizes": null
        },
        {
          "id": "uuid", "itemType": "beans", "drinkId": null, "brewerId": null,
          "name": null, "description": null, "price": null, "available": true, "source": null,
          "beanFields": ["flavorProfile", "origin", "process", "roastDate"],
          "beanBatches": "once",
          "showMethod": null,
          "showIngredients": null,
          "sizes": null
        },
        {
          "id": "uuid", "itemType": "other", "drinkId": null, "brewerId": null, "otherItemId": "uuid",
          "name": null, "description": null, "price": 3.5, "available": true,
          "source": { "name": "Almond croissant", "description": "Baked daily", "kind": null, "method": null, "archived": false },
          "beanFields": null, "beanBatches": null, "showMethod": null, "showIngredients": null, "sizes": null
        }
      ]
    }
  ],
  "otherItems": [
    { "id": "uuid", "name": "Almond croissant", "description": "Baked daily", "menuItemCount": 1 }
  ]
}
```

Every item has `drinkId`, `brewerId` and `otherItemId`, the one matching its
`itemType` set (none for the beans block). `otherItems` is the menu's list of
other items, by name, each with how many sections show it.

`source` is what the item shows by default (`method`: how it's made, the
brewer's method name for a plain brew, §3e, or the drink's kind): a drink's name and description,
or a brewer's name (brewers have no menu description; set one on the item),
or an other item's name and description (`kind` and `method` `null`); `null`
for the beans block.

`beanFields` (the beans block only; `null` on other items) is what guests see
about each bean besides its roaster and name: a list of `BEAN_MENU_FIELDS`
(`flavorProfile`, `origin`, `producer`, `altitude`, `variety`, `process`, `roastLevel`,
`roastDate`, `decaf`, `blendType`, `roastType`), each once; `null` = all of
them. The public menu (§7) sends only those.

`beanBatches` (the beans block only; `null` on other items) is what the
block does with the same coffee more than once (same roaster and bean name,
e.g. two batches): `"each"` (or `null`) lists each, with what tells them
apart; `"once"` shows only the freshest that isn't frozen (§7).

`showMethod` and `showIngredients` (the menu's) are what drinks and brewers
show under them on the public menu by default: how it's made ("Filter",
"Espresso", on by default) and a drink's ingredients (off by default). An
item's own `showMethod` / `showIngredients` (`null` on the beans block)
override them: `true` show, `false` hide, `null` the menu's default.
Always `null` on other items, which show neither.

`sizes` (drinks, brewers and other items; `null` on the beans block) is a price per
size instead of the one `price`: `[{ "label": "8 oz", "price": 4 },
{ "label": "12 oz", "price": 4.75 }]`, in the order guests see them. 1–6
sizes, each `label` 1–30 chars and once (case-insensitive), each `price` as
for `price` or `null` (none shown). An item has a `price` or `sizes`, never
both (`400`); `null` = one size.

**Branding:** `accentColor` (`"#rrggbb"`, or `null` for the app's brown)
colours the menu's title, headings and rules; `tagline` is a line under the
title. `logoIds` are the menu's logos in order, up to 6 (`MAX_MENU_LOGOS`):
the first, also sent as `logoId` (`null` for none), is the one guests see
(the public menu's `logoUrl`, §7); the others are kept to swap in by
reordering. Each image is `GET /api/public/menu/:slug/logo/:id` (§7).
Colour and tagline are set with `PATCH /`, the logos with `/logos` below;
all in Settings → Workspace, where the logos work like a bean's photos
(drag ⠿ to reorder, crop, remove).

## `GET /`

- **Errors:** `404` not a member.

## `GET /preview`

The menu as guests would see it: exactly the public menu's shape (§7), built
the same way, but for any member and whether or not the public menu is on.
The builder's Preview shows it.

- **Errors:** `404` not a member.

## `PATCH /`

- **Body:** any non-empty subset of `{ "currency": "usd" | null, "title":
  "The Brew Bar" | null, "showMethod": true, "showIngredients": false,
  "accentColor": "#8a4b2a" | null, "tagline": "Coffee, slowly" | null }`.
  `currency` is an ISO 4217 code (uppercased). `accentColor` is
  `#` and 6 hex digits (stored lowercase); `tagline` ≤ 255 chars, blank =
  `null`.
  `title` is the public menu's heading, ≤ 255 chars; blank or `null` uses the
  workspace name. Both are set in Settings → Workspace, with the public
  menu's on/off switch (§2). `showMethod` and `showIngredients` are the
  defaults above, switched at the top of the builder.
- **Errors:** `400` invalid, or a `null` currency while items still have
  prices (or sizes with prices); `403` viewer.

## `POST /logos`

Adds a logo, last: the image itself as the body (any image type, ≤ 15 MB),
like a bean photo (`bean-photos.md` §4c): turned upright, fit inside
1024 px, stored as WebP with no metadata, transparency kept. Each image has
its own id, never reused (it's cached for good).

- **Success (`201 Created`):** the menu.
- **Errors:** `400` not an image; `403` viewer; `409` already 6.

## `PUT /logos/order`

- **Body:** `{ "logoIds": ["uuid", ...] }`: every logo exactly once, in the
  new order; the first is the one the menu shows.
- **Errors:** `400` invalid, or not every logo exactly once; `403` viewer.

## `PUT /logos/:logoId/image`

A new image for a logo (cropped or rotated in the browser, which keeps a
transparent background: PNG), processed as for `POST`. It takes the logo's
place under a **new id**, and the old file is removed. Works on a full list.

- **Errors:** `400` not an image; `403` viewer; `404` no such logo.

## `DELETE /logos/:logoId`

Removes a logo; the next one moves up. No confirmation: nothing else uses
it.

- **Errors:** `403` viewer; `404` no such logo.

## Other items

Things on the menu that aren't a drink or brewer, kept in their own list
(the menu's `otherItems`) and placed in sections with `POST
/sections/:sectionId/items` like a drink, so each placement has its own
name override, price or sizes and availability. Deleting a section only
takes them off it. The builder manages them in an "Other items" dialog and
offers them in its add picker.

### `POST /other-items`

- **Body:** `{ "name": "Almond croissant", "description"?: "Baked daily" }`:
  name 1–100 chars, unique per workspace (case-insensitive); description ≤
  500 (blank = `null`).
- **Errors:** `400`; `403` viewer; `409` name taken.

### `PATCH /other-items/:otherItemId`

- **Body:** any non-empty subset of `{ "name", "description" }`.
- **Errors:** `400`; `403`; `404` not in this workspace; `409` name taken.

### `GET /other-items/:otherItemId/usage`

`{ "menuItemCount": 2 }`: the sections that would lose it (README,
"Archiving and deleting"). Any member.

- **Errors:** `404`.

### `DELETE /other-items/:otherItemId`

Deletes it and takes it off every section. The builder shows the usage
first and asks for "I understand" when it's on the menu.

- **Errors:** `403`; `404`.

## `POST /sections`

- **Body:** `{ "name": "Pour over", "description"?: "..." }`: name 1–100
  chars, unique per menu (case-insensitive); description ≤ 500. It goes last.
- **Errors:** `400`; `403` viewer; `409` name taken.

## `PATCH /sections/:sectionId`

- **Body:** any non-empty subset of `{ "name", "description" }`.
- **Errors:** `400`; `403`; `404` not in this menu; `409` name taken.

## `DELETE /sections/:sectionId`

Deletes the section and its items (not the drinks, brewers or other items).

- **Errors:** `403`; `404`.

## `PUT /layout`

The whole arrangement at once, as a drag-and-drop or ↑/↓ editor has it: every
section of the menu exactly once, in the new order, each with its items in
order. Items can move between sections this way.

- **Body:** `{ "sections": [ { "id": "uuid", "itemIds": ["uuid", ...] } ] }`
- **Errors:** `400` a section or item missing, unknown or listed twice, or a
  drink, brewer or other item twice in one section; `403`.

## `POST /sections/:sectionId/items`

- **Body:** `{ "itemType": "drink" | "brewer" | "beans" | "other", "drinkId"?,
  "brewerId"?, "otherItemId"?, "name"?, "description"?, "price"?,
  "available"? }`. A drink item needs `drinkId` (and no other id), a brewer
  item `brewerId`, an other item `otherItemId`, the beans block none. `name` ≤ 255 and `description` ≤ 500 (blank = `null`); `price`
  0–999999.99, at most 2 decimals, and only once the menu has a `currency`;
  `available` defaults to `true`. `beanFields` (optional, nullable) is only
  for the beans block, and so is `beanBatches` (optional, nullable);
  `showMethod` and `showIngredients` (optional, nullable) only for drinks
  and brewers, and `sizes` (optional, nullable) for drinks, brewers and
  other items. It goes last in the section.

  Or several at once: `{ "items": [ { ...item }, ... ] }` (1–100), each with
  the same rules. They go last, in the order sent, and it's **all or
  nothing**: if any is refused, none are added.
- **Errors:** `400` invalid body, a drink, brewer or other item not in this workspace, or
  a price without a currency; `403`; `404` section not in this menu; `409`
  already in this section (or sent twice), or the menu already has the beans
  block.

## `PATCH /items/:itemId`

- **Body:** any non-empty subset of `{ "name", "description", "price",
  "available", "beanFields", "beanBatches", "showMethod", "showIngredients",
  "sizes" }`, same rules (`beanFields` or `beanBatches` on a drink or brewer
  item, or `showMethod`, `showIngredients` or `sizes` on the beans block, is
  a `400`, and so are `showMethod` or `showIngredients` on an other item;
  so is a `price` while the item keeps its `sizes`, or the other
  way round: clear one in the same request). To move an item, use `PUT /layout`.
- **Errors:** `400`; `403`; `404`.

## `DELETE /items/:itemId`

- **Errors:** `403`; `404`.
