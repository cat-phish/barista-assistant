# 3. Brewers

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

What makes the coffee: a V60, a French press, an AeroPress, an OXO Rapid
Brewer, an espresso machine, a moka pot. Recipes (§5) belong to a brewer from
their workspace's list. How a cup is brewed (pour over, a soup shot, moka) is
the recipe's `style` (§5).

- **Brew method** (`kind`, one of `METHOD_KINDS`): how brewers are grouped
  (brewers have no category; categories are for drinks, §5d), and it changes
  how the app works. It decides the recipe fields, steps and timer, and which
  drinks the brewer can make (a drink needs a method, §5c).

  | `kind` | Examples | Recipe fields (§5) |
  |---|---|---|
  | `filter` | V60, Chemex, French press, AeroPress, OXO Rapid Brewer | dose + water, estimated yield, steps with pours |
  | `espresso` | Linea Mini, Gaggia Classic | dose + target yield (no water), shot time and first-drop windows |
  | `stovetop` | Moka pot, ibrik | as filter |
  | `other` | Siphon, anything else | as filter |

  Making the list editable (custom methods based on these) is backlog item 2.

New workspaces get V60 (`filter`), Espresso (`espresso`) and Aeropress
(`filter`). Milk drinks like a latte are drinks (§5c):
they need espresso, so any espresso brewer can make them; The Atlas needs
filter coffee, so any filter brewer (a V60, a French press, an OXO) can.

**Espresso capabilities** describe who controls each part of the shot, so the
shot timer notes what the machine can't do and the AI knows what can be
adjusted. Other kinds keep `none`.

| Field | Values (default `none`) |
|---|---|
| `preinfusion` | `none`, `automatic` (the machine does it), `manual` (paddle, lever or button) — `PREINFUSION_MODES` |
| `flowControl`, `pressureControl` | `none`, `manual` (paddle, lever, needle valve), `programmable` (profiles) — `PROFILE_CONTROLS` |

**Brewing and the menu:** when brewing, "What are you making?" lists the
methods that have active brewers; picking one asks for the brewer, then its
recipe. The public menu shows a brewer's plain brew only where the menu
builder (§7b) places it, under the item's name (e.g. "Espresso" for a Linea
Mini).

Archiving works like grinders (§3b): archived brewers leave the pickers, and
past brews keep showing them. `createdAt` (read-only) is when the brewer was added.

**Brewer object:**

```json
{
  "id": "uuid",
  "name": "Linea Mini",
  "kind": "espresso",
  "notes": "18 g VST basket",
  "preinfusion": "manual",
  "flowControl": "manual",
  "pressureControl": "none",
  "archivedAt": null,
  "createdAt": "2026-10-18T09:00:00.000Z"
}
```

## `GET /api/workspaces/:workspaceId/brewers`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewers": [ { ...brewer } ] }`: active first,
  then archived, each by `name`.

## `POST /api/workspaces/:workspaceId/brewers`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Chemex", "kind": "filter" }` (`name` trimmed,
  1–100 chars; `kind` optional, default `filter`). Optional: `notes`
  (≤ 255) and the capabilities (default `none`). Blank text becomes `null`.
  Unknown fields are rejected, including the removed `categoryId`,
  `menuName`, `description` and `showOnPublicMenu`.
- **Success (`201 Created`):** `{ "brewer": { ...brewer } }`
- **Errors:** `400` invalid body; `403`
  viewer; `409` a brewer with that name already exists in this workspace
  (case-insensitive).

## `PATCH /api/workspaces/:workspaceId/brewers/:brewerId`

Recipes and brew logs reference it by ID, so a rename shows up everywhere at once.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of the `POST` fields (same rules), plus
  `archived` (`true` archives it, keeping the first archive date; `false`
  restores it).
- **Success (`200 OK`):** `{ "brewer": { ...brewer } }`
- **Errors:** `400` invalid or empty body; `403` viewer; `404` not in this workspace; `409` another brewer
  already has that name (case-insensitive; changing only the case is
  allowed), or the kind would change while recipes use it (recipe fields
  differ by kind), with body `{ "error": "...", "recipeCount": 2 }`.

## `DELETE /api/workspaces/:workspaceId/brewers/:brewerId`

The database cascades a brewer's deletion to its recipes, so the API is what
protects them, and brew history keeps a brewer once used. Drinks don't tie up
a brewer (they need a kind, not a device).

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` recipes or
  brew logs use it, with body
  `{ "error": "...", "recipeCount": 2, "brewLogCount": 5 }`. Move or delete
  the recipes first; with only brew logs left, archive it instead.
