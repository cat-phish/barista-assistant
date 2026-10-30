# 2c. Flavor Lexicon (a workspace's flavor wheel)

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The flavor wheel the brew form offers for `flavors` (§6). Every workspace
starts on the **built-in wheel** (`DEFAULT_LEXICON`,
`@barista/shared/flavors`: our own, on the common tasting vocabulary). An
owner can replace it with **their own lexicon file**, built from any source
they like. How to build one is in
[`docs/custom-flavor-wheel.md`](../custom-flavor-wheel.md); this repository
ships no lexicon but the built-in one.

Code: `backend/src/routes/flavorLexicon.ts`, `backend/src/flavorLexicon.ts`,
`parseLexicon` in `shared/src/flavors.ts`; stored in `flavor_lexicons` (no
row = built-in).

**Lexicon file** (what every endpoint returns as `lexicon`, and what `PUT`
takes):

```json
{
  "format": "barista-flavor-lexicon",
  "version": 1,
  "name": "House wheel",
  "flavors": [
    { "key": "fruity", "label": "Fruity", "color": "#d0453f" },
    { "key": "fruity.citrus", "label": "Citrus" },
    { "key": "fruity.citrus.lemon", "label": "Lemon" }
  ]
}
```

- `format` must be `"barista-flavor-lexicon"`; `version` `1` (a higher one
  is a `400`, "made for a newer version").
- `name`: 1–100 characters, trimmed.
- `flavors`: 1–500, in **wheel order**. Each:
  - `key`: lowercase letters, digits and `_`, in up to three parts joined
    by dots (`^[a-z0-9_]+(\.[a-z0-9_]+){0,2}$`), at most 64 characters,
    unique. The dots place it: `fruity.citrus` sits under `fruity`, which
    must be listed **before** it.
  - `label`: 1–60 characters, trimmed.
  - `color` (optional): `#rrggbb`, stored lower-case. Without one, a flavor
    takes a lighter shade of the nearest colour further in, and an
    inner-ring flavor one from the built-in palette.
  - Fields it doesn't know are ignored and not kept.
- Errors name the first problem and where it is, e.g.
  `flavors[3].key: "sour" must be listed before "sour.citrus"`.

## `GET /api/workspaces/:workspaceId/flavor-lexicon`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "lexicon": { …file }, "custom": false, "updatedAt": null }`.
  `custom` says whether it's the workspace's own; `updatedAt` is when that
  was imported (`null` for the built-in wheel). The `lexicon` is a valid
  file as is: clients offer it as a download to start a wheel from.

## `PUT /api/workspaces/:workspaceId/flavor-lexicon`

Replaces the wheel with the file sent (the body is the file).

- **Auth Required:** `true` (role `owner`)
- **Success (`200 OK`):** as `GET`, `custom: true`.
- **Errors:** `400` not a valid lexicon file (the message says where);
  `403` not an owner.

## `DELETE /api/workspaces/:workspaceId/flavor-lexicon`

Back to the built-in wheel.

- **Auth Required:** `true` (role `owner`)
- **Success (`200 OK`):** as `GET`, `custom: false`.
- **Errors:** `403` not an owner.

## When the wheel changes

Brews store each pick's **key and its label at the time**
(`brew_log_flavors.label`, §6), so changing the wheel never loses a
tasting:

- A brew's `flavors` show in the current wheel's order with its labels; a
  pick the wheel no longer has shows **by its saved label**, after the
  others, and is uncoloured in clients.
- New brews can only pick the current wheel's keys (`400` otherwise).
  Editing a brew can **keep** a pick it already had, even one the wheel no
  longer has (with its saved label), but not add one.
- The AI (§9) reads picks with their place on the current wheel
  ("Lemon (Fruity › Citrus)"), or just the saved label.
- Keep a flavor's `key` when you rename it: a new key is a new flavor, and
  brews with the old one keep the old label.
- Backups carry the wheel in the file's `workspace` block (`backup.md`
  §2b); exporting and importing **lists** doesn't (a brew's picks come
  with it, with their labels).
