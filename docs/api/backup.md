# 2b. Backup and Restore

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

A **backup** is a whole workspace as one JSON file: every list, bean,
recipe, drink, the menu, and every brew with its marks, prep tools,
problems and AI analyses. A **restore** turns a backup into a **new**
workspace owned by the person restoring; nothing existing is changed. The
app offers both on Settings → Data, and restore also on the workspaces page
(a new server has no workspace yet). Code: `backend/src/backup.ts`.

## The file

```json
{
  "format": "barista-backup",
  "version": 1,
  "exportedAt": "2026-10-23T08:00:00.000Z",
  "workspace": { "name": "Home bar", "slug": "home-bar", "settings": { "roastScale": "levels" }, "menuTitle": null, "menuCurrency": "USD", "isPublicMenuEnabled": true },
  "tables": {
    "brewer_methods": [ { "id": "uuid", "name": "Filter", "builtin": "filter", "...": "…" } ],
    "brew_logs": [ { "id": "uuid", "beanId": "uuid", "brewedBy": "barista@example.com", "...": "…" } ]
  }
}
```

- **`tables`**: rows by database table name, as stored, columns by their API
  (camelCase) names, without `workspaceId`. IDs are kept as they were: they
  only link rows inside the file. Timestamps are ISO strings, dates
  `YYYY-MM-DD`, decimals numbers.
- **Tables, in restore order:** `brewer_methods`, `bean_processes`,
  `recipe_styles`, `grinders`, `water_profiles`, `prep_tools`,
  `brew_problems`, `ingredients`, `drink_categories`, `brewers`, `beans`,
  `bean_freezes`, `recipes`, `recipe_steps`, `recipe_grind_settings`,
  `drinks`, `drink_ingredients`, `menu_sections`, `menu_items`,
  `brew_logs`, `brew_log_marks`, `brew_log_tools`, `brew_log_problems`,
  `llm_analyses` (`BACKUP_TABLES`). A table left out of a file counts as
  empty.
- **Not in a backup:** people, members, notification channels and
  preferences belong to the server, not the workspace. A brew says who made
  it as `brewedBy` (their email, or `null`) instead of `userId`.
- **`version`** goes up only when an older file can't be restored as is;
  the server upgrades older versions on restore and refuses newer ones.
  New optional columns don't change it (an older file just lacks them).

**Adding a table** to the schema means deciding: back it up (add it to
`BACKUP_TABLES` in insert order, any enum column to `ENUMS`, any JSON
column to `JSON_SCHEMAS`) or leave it out (`NOT_BACKED_UP`). A test fails
until one is done, and another checks each table only points at tables
above it.

## `GET /api/workspaces/:workspaceId/backup`

- **Auth Required:** `true` (role `owner`)
- **Success (`200 OK`):** the file above, with
  `Content-Disposition: attachment; filename="<slug>-backup-YYYY-MM-DD.json"`.
- **Errors:** `403` not an owner; `404` not a member.

## `POST /api/workspaces/restore`

- **Auth Required:** `true` (anyone signed in; they own the new workspace)
- **Body** (up to 50 MB, unlike the usual 100 kB):
  `{ "name": "Home bar", "slug": "home-bar", "backup": { ...file } }`.
  `name` and `slug` follow §2's rules.
- **What happens:** the whole file is checked first (format, version, every
  table and column known, values of the column's type, enum values, every
  reference pointing at a row in the file). Then, in one transaction:
  - a new workspace with that name and slug, the file's settings, menu
    title and currency, the public menu **off**, and the caller as its only
    member (owner). The default lists a new workspace gets (§2) are **not**
    added: the file has the workspace's own;
  - every row inserted with a new ID and its references rewritten; archive
    dates, positions and "date added" (`createdAt`) are kept;
  - every brew belongs to the caller (`brewedBy` is only kept in the file).
- **Success (`201 Created`):** `{ "workspaceId": "uuid" }`
- **Errors:** `400` the first problem found, e.g.
  `"tables.recipes[3].brewerId: not in the file"` or
  `"backup.version: made by a newer version of the app; update this server
  first"`; `409` `"Slug already taken"`, or the file repeats a name a
  workspace keeps unique (two grinders called "C40"); `413` larger than 50
  MB. Nothing is created on an error.
