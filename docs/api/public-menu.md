# 7. Public Menu Endpoint

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Retrieves the read-only menu for a workspace, as arranged in the menu builder
(§7b). Unauthenticated, and only for workspaces where
`isPublicMenuEnabled = true`. Members can see the same response while it's off from
`GET /api/workspaces/:id/menu/preview` (§7b).

- **URL:** `GET /api/public/menu/:slug`
- **Auth Required:** `false`
- **Success Response (`200 OK`):**
  ```json
  {
    "title": "Jordan's Coffee Bar",
    "tagline": "Coffee, slowly",
    "accentColor": "#8a4b2a",
    "logoUrl": "/api/public/menu/jordans-coffee-bar/logo/uuid",
    "workspace": { "name": "Jordan's Coffee Bar", "slug": "jordans-coffee-bar" },
    "currency": "USD",
    "sections": [
      {
        "name": "Espresso milk drinks",
        "description": null,
        "items": [
          {
            "type": "drink",
            "id": "uuid",
            "name": "Vanilla Latte",
            "description": null,
            "method": "Espresso",
            "variantOf": "Latte",
            "ingredients": [],
            "price": null,
            "sizes": [{ "label": "8 oz", "price": 5.5 }, { "label": "12 oz", "price": 6 }],
            "available": true
          },
          {
            "type": "brewer",
            "id": "uuid",
            "name": "Espresso",
            "description": "Our house blend",
            "method": "Espresso",
            "variantOf": null,
            "ingredients": [],
            "price": 3.5,
            "sizes": null,
            "available": false
          }
        ]
      },
      {
        "name": "Today's coffee",
        "description": null,
        "items": [
          {
            "type": "beans",
            "fields": ["flavorProfile", "origin", "producer", "altitude", "variety", "process", "roastLevel", "roastDate", "decaf", "blendType", "roastType"],
            "beans": [
              {
                "id": "uuid",
                "roasterName": "Onyx Coffee Lab",
                "beanName": "Southern Weather",
                "process": "Washed",
                "roastDate": "2026-10-01T00:00:00.000Z",
                "freezes": [{ "frozenOn": "2026-10-08", "thawedOn": "2026-10-20" }],
                "roastLevel": "light",
                "detailedRoastLevel": "city",
                "roastType": "filter",
                "blendType": "single_origin",
                "decaf": false,
                "flavorProfile": "Milk chocolate, plum, cane sugar",
                "originArea": "south_america",
                "country": "Colombia",
                "region": "Huila",
                "altitudeMasl": 1950,
                "producer": "Finca El Paraíso",
                "varieties": ["Pink Bourbon"],
                "species": ["arabica"]
              }
            ]
          }
        ]
      }
    ]
  }
  ```
  - `title` is the menu's title from the builder (§7b), else the workspace
    name. `tagline`, `accentColor` and `logoUrl` are the menu's branding
    (§7b), each `null` when not set; the page colours the title, headings
    and rules with `accentColor` (lightened in dark mode), and shows the
    logo above the title.
  - Sections and items follow the builder's order. Sections with nothing to
    show are left out.
  - An item's `name` and `description` are the builder's overrides, else the
    drink's own (a brewer's name; brewers have no description of their own).
    `method` is how it's made ("Filter", "Espresso"), or `null` when the
    item doesn't show it. `variantOf` names the
    parent drink only if that drink is on the menu too (under its menu name);
    the guest page doesn't show it (say so in the description if you want to).
    `ingredients` are ingredient names in the drink's order, or `[]` when the
    item doesn't show them. Whether an item shows its method and ingredients
    is the menu's default (method on, ingredients off) unless the item says
    otherwise (`showMethod`, `showIngredients`, §7b). `price` is in the
    menu's `currency` (`null` = no price); `sizes` is a price per size
    instead (§7b), `null` for one size; `available: false` items are still
    listed, for the page to mark.
  - Archived brewers, and items whose drink or brewer is gone, are left out.
  - The beans block lists active (not archived, §4) beans with
    `showOnPublicMenu`, by roaster then name. Each has its `id`,
    `roasterName` and `beanName`, plus only the details in `fields` (chosen
    in the builder, §7b; all of them by default): `origin` is `originArea`,
    `country` and `region`; `process` is the process's name (§4b); `roastLevel` is `roastLevel` and
    `detailedRoastLevel` (always `null` while the workspace records roasts
    light to dark, `settings.roastScale` "levels", §2); the others are the bean field of the same name
    (`altitude` = `altitudeMasl`; `variety` is `varieties` and `species`;
    `roastDate` also sends the bean's `freezes`, oldest first, so the page
    counts **days off roast** each day, not counting days frozen:
    "12 days off roast", docs/api/beans.md §4).
    The guest page shows the varieties after the origin, and the species
    as a badge unless it's arabica alone. A field that isn't chosen is left out of
    each bean, not sent as `null`. A bean's stock, price, bag weight, purchase
    date, green supplier, website, rating and notes are never published; nor
    are recipe details (doses, steps).
  - **The same coffee more than once** (same roaster and bean name, ignoring
    case and spaces; e.g. two batches): with the block's `beanBatches`
    `"once"`, only the freshest is listed (the youngest by days off roast
    among those not frozen now, or among all if every one is frozen). With
    `"each"` (the default), each is listed and carries `differs`: what tells
    them apart, from the fields in `fields` plus `"batchNumber"`. If none of
    those differ, it's every field that does, and those fields are sent even
    though the block hides them. `batchNumber` is sent only when `differs`
    has it; the page shows "Batch 3".
- **Error Responses:**
  - `404 Not Found`: Workspace slug does not exist or `isPublicMenuEnabled` is
    `false`. Slugs are matched exactly: `/menu/Jordans-Coffee-Bar` is a `404`,
    so each menu has exactly one URL (and one offline cache entry).

## `GET /api/public/menu/:slug/logo/:logoId`

The menu's logo (`logoUrl` above): WebP, `Cache-Control: public,
immutable`. Served while the public menu is off too, so the builder's
preview and Settings can show it: the id is random and changes with each
upload, so only someone who has seen the menu knows the URL. `404` if the
slug or id doesn't match the current logo. The service worker caches it
with the menu, so it shows offline.
