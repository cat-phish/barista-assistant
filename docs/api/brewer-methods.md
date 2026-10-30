# 3e. Brewer Methods

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

How the workspace groups its brewers (Settings → Lists): what "What are you
making?" lists first when brewing, the brewer list's Method column, and how
the menu builder groups plain brews. Every workspace starts with the
built-ins (`METHOD_NAMES` in `docs/schema.md`): Filter, Espresso, Stovetop,
Other. Brewers point at one with `methodId` (§3).

- **Behaviour:** every method behaves like one of `METHOD_KINDS` (itself
  for a built-in). A custom method picks one: "Siphon" behaves like
  `filter`, "Turkish" like `stovetop`. A brewer's `kind` is always its
  method's behaviour, so recipe fields, the timer, recipe styles (§5e),
  drinks (§5c), prep tools (§3d) and the AI keep working off the kind. A
  drink still needs a kind ("filter coffee"), so a filter drink can be
  made on any filter-like brewer, Siphon ones too.
- **Built-ins** keep their `builtin` key and always behave like themselves.
  They can be renamed and hidden, not deleted.
- **Hidden** methods are left out of the brewer form's choices; brewers
  already in one stay there and still show under it.
- **Custom** methods (`builtin: null`) can change their behaviour while
  none of their brewers has recipes (their brewers' kind changes with it),
  and can be deleted: their brewers move to the built-in method of the same
  behaviour first, so nothing else about them changes.
- The public menu (§7) says how a plain brew is made by its brewer's
  method name ("Siphon").

**Method object:**
`{ "id": "uuid", "name": "Siphon", "position": 5, "hidden": false, "builtin": null, "behaviour": "filter" }`

## `GET /api/workspaces/:workspaceId/brewer-methods`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "methods": [ { ...method } ] }`, by `position`,
  hidden ones included.

## `POST /api/workspaces/:workspaceId/brewer-methods`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Siphon", "behaviour": "filter" }` (`name` trimmed,
  1–100 chars, unique per workspace, case-insensitive). It goes last.
- **Success (`201 Created`):** `{ "method": { ...method } }`
- **Errors:** `400`; `403` viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/brewer-methods/:methodId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of `{ "name", "hidden", "behaviour" }`.
  `behaviour` only changes on a custom method; its brewers' `kind` changes
  with it.
- **Success (`200 OK`):** `{ "method": { ...method } }`
- **Errors:** `400` (including a built-in's behaviour); `403` viewer; `404`
  not in this workspace; `409` name taken, or the behaviour would change
  while recipes use its brewers, with body
  `{ "error": "...", "recipeCount": 2 }` (like changing a brewer's kind, §3).

## `PUT /api/workspaces/:workspaceId/brewer-methods/order`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "methodIds": ["uuid", …] }`: every method exactly once.
- **Success (`200 OK`):** `{ "methods": [ { ...method } ] }`
- **Errors:** `400` not exactly the workspace's methods; `403` viewer.

## `GET /api/workspaces/:workspaceId/brewer-methods/:methodId/usage`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewerCount": 1 }`
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/brewer-methods/:methodId`

Custom methods only. Its brewers move to the built-in method of the same
behaviour; their recipes and brews don't change.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` a built-in
  (hide it instead).

> **Frontend requirement:** load the usage first; when brewers use it, say
> they'll move and require "I understand" before deleting (CLAUDE.md rule 7).
