# 7. Public Menu Endpoint

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Retrieves the read-only menu for a workspace. Unauthenticated, but strictly
filters for workspaces where `isPublicMenuEnabled = true` and items where
`showOnPublicMenu = true`. The menu lists active **brewers** (§3), **drinks**
(§5c) and beans.

- **URL:** `GET /api/public/menu/:slug`
- **Auth Required:** `false`
- **Success Response (`200 OK`):**
  ```json
  {
    "workspace": {
      "name": "Jordan's Coffee Bar",
      "slug": "jordans-coffee-bar"
    },
    "beans": [
      {
        "id": "uuid",
        "roasterName": "Onyx Coffee Lab",
        "beanName": "Southern Weather",
        "process": "Washed",
        "roastDate": "2026-10-01T00:00:00.000Z",
        "inventoryWeightGrams": 250
      }
    ],
    "sections": [
      {
        "category": "Espresso milk drinks",
        "items": [
          {
            "kind": "drink",
            "id": "uuid",
            "name": "Vanilla Latte",
            "description": null,
            "method": "Espresso",
            "variantOf": "Latte",
            "ingredients": ["Steamed milk", "Vanilla syrup"]
          }
        ]
      },
      {
        "category": null,
        "items": [
          {
            "kind": "brewer",
            "id": "uuid",
            "name": "V60",
            "description": "Single-origin pour over",
            "method": "Filter",
            "variantOf": null,
            "ingredients": []
          }
        ]
      }
    ]
  }
  ```
  Sections follow the categories' `position`; uncategorised items come last
  (`category: null`), and empty sections are left out. In each section, plain
  brewers come first, then drinks, each sorted by name. A brewer shows under
  its `menuName` if set, else its name; `method` is how the item is made
  ("Filter", "Espresso"); `variantOf` the parent drink's name if that drink is also
  shown, else `null`; `ingredients` are the ingredients' names in the drink's
  order. Recipe details (doses, steps) aren't published.
- **Error Responses:**
  - `404 Not Found`: Workspace slug does not exist or `isPublicMenuEnabled` is
    `false`. Slugs are matched exactly: `/menu/Jordans-Coffee-Bar` is a `404`,
    so each menu has exactly one URL (and one offline cache entry).
