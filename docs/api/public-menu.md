# 7. Public Menu Endpoint

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Retrieves the read-only menu for a workspace, as arranged in the menu builder
(§7b). Unauthenticated, and only for workspaces where
`isPublicMenuEnabled = true`.

- **URL:** `GET /api/public/menu/:slug`
- **Auth Required:** `false`
- **Success Response (`200 OK`):**
  ```json
  {
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
            "ingredients": ["Steamed milk", "Vanilla syrup"],
            "price": 6,
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
            "beans": [
              {
                "id": "uuid",
                "roasterName": "Onyx Coffee Lab",
                "beanName": "Southern Weather",
                "process": "washed",
                "roastDate": "2026-10-01T00:00:00.000Z",
                "inventoryWeightGrams": 250,
                "roastLevel": "light",
                "detailedRoastLevel": "city",
                "roastType": "filter",
                "blendType": "single_origin",
                "decaf": false,
                "flavorProfile": "Milk chocolate, plum, cane sugar",
                "region": "Huila",
                "altitudeMasl": 1950,
                "producer": "Finca El Paraíso"
              }
            ]
          }
        ]
      }
    ]
  }
  ```
  - Sections and items follow the builder's order. Sections with nothing to
    show are left out.
  - An item's `name` and `description` are the builder's overrides, else the
    drink's own (a brewer's name; brewers have no description of their own).
    `method` is how it's made ("Filter", "Espresso"). `variantOf` names the
    parent drink only if that drink is on the menu too (under its menu name).
    `ingredients` are ingredient names in the drink's order. `price` is in the
    menu's `currency` (`null` = no price); `available: false` items are still
    listed, for the page to mark.
  - Retired brewers, and items whose drink or brewer is gone, are left out.
  - The beans block lists active (not archived, §4) beans with
    `showOnPublicMenu`, by roaster then name, with their roast, blend and
    origin details and `decaf`. A bean's price, bag weight, purchase date,
    green supplier, website, rating and notes aren't published; nor are
    recipe details (doses, steps).
- **Error Responses:**
  - `404 Not Found`: Workspace slug does not exist or `isPublicMenuEnabled` is
    `false`. Slugs are matched exactly: `/menu/Jordans-Coffee-Bar` is a `404`,
    so each menu has exactly one URL (and one offline cache entry).
