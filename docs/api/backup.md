# 2b. Backup and Restore

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

A **backup** is a whole workspace as one JSON file (or, with its bean
photos, a `.zip` holding that file and the photos): every list, bean,
recipe, drink, the menu, and every brew with its marks, prep items,
problems and AI analyses. A **restore** turns a backup into a **new**
workspace owned by the person restoring; nothing existing is changed. An
**export** is the same file format holding only some lists, and an
**import** brings lists from an export or a backup into the current
workspace ("By list"). A **CSV** is a spreadsheet of the journal or the
beans, for reading only.

## Where it is

Everything here is for **owners** (restore: anyone signed in, who owns the
new workspace).

| What | In the app | Endpoint | Code |
| --- | --- | --- | --- |
| Back up the whole workspace | Settings → Data → Back up | `GET …/backup` | `backend/src/backup.ts` |
| Restore a backup as a new workspace | Settings → Data → Restore; the workspaces page | `POST /api/workspaces/restore` | `backup.ts` |
| Export whole lists (several at once) | Settings → Data → Export lists | `POST …/export` | `backend/src/listImport.ts` |
| Export chosen items of one list | each list page: **Select to export…** | `POST …/export` with `ids` | `listImport.ts` |
| Import lists (several at once) | Settings → Data → Import | `POST …/import/preview`, `…/import` | `listImport.ts` |
| Import one list | each list page: **Import…** | the same, with `lists: [that list]` | `listImport.ts` |
| Spreadsheet (CSV) | Settings → Data → Spreadsheet | `GET …/csv/:list` | `backend/src/csv.ts` |

**List pages** (Journal, Beans, Recipes, Drinks, Ingredients, Brewers,
Grinders, Water profiles, Prep, and brew problems on Settings →
Lists) have one bar, `frontend/src/components/ListDataBar.vue`:
"Select to export…" (the rows get ticks; "Export selected" downloads them
with what they need) and "Import…" (a dialog with the import below,
limited to that list; a file without it is refused with what it does have).
Exporting a whole list, several lists, CSV and backups are only on
Settings → Data. The frontend's pieces: `api/backup.ts` (calls and types),
`lib/backup.ts` (reading files, names, labels), `components/ImportLists.vue`
(the import with its preview, used by both places),
`components/RestoreBackup.vue`, `views/SettingsDataView.vue`.

## The file

```json
{
  "format": "barista-backup",
  "version": 3,
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
  `brew_problems`, `ingredients`, `drink_categories`, `brewers`,
  `roasting_machines`, `green_coffees`, `prep_tool_brewers`, `beans`,
  `bean_freezes`, `bean_photos`, `roasts`, `recipes`, `recipe_steps`, `recipe_grind_settings`, `recipe_prep_tools`,
  `drinks`, `drink_ingredients`, `menu_sections`, `menu_items`,
  `brew_logs`, `brew_log_marks`, `brew_log_tools`, `brew_log_problems`,
  `brew_log_flavors`, `llm_analyses`, `parameter_suggestions` (`BACKUP_TABLES`). A table left out of a file counts as
  empty.
- **Not in a backup:** people, members, notification channels and
  preferences belong to the server, not the workspace. A brew says who made
  it as `brewedBy` (their email, or `null`) instead of `userId`, and a
  parameter suggestion who asked the same way (`brewedBy` for
  `requestedBy`). A suggestion's `alternatives` keep the ids they named,
  which aren't rewritten: once restored, the brew page shows them by name
  only. People's own AI prompts (`docs/api/auth.md` §1c) and
  added Insights charts (`docs/api/stats.md` §11b) aren't in it.
  `analysis_requests` (when an automatic analysis is due, why one failed,
  §8) is queue state and isn't backed up either.
- **`version`** goes up only when an older file can't be restored as is;
  the server upgrades older versions on restore and refuses newer ones.
  New optional columns don't change it (an older file just lacks them).
  Versions so far (`UPGRADES` in `backend/src/backup.ts`):
  - **2:** a prep item's one `methodKind` (`null` = every method) became
    `methodKinds` (`[]` = every brew), plus the brewers it's offered for
    (`prep_tool_brewers`). A version 1 file restores with `[methodKind]`
    or `[]`, and no brewers.
  - **3:** Suggest parameters' `bean`, `beanRecipe` and `beanBrewer` sources
    (this exact bean) became `bag`, `bagRecipe` and `bagBrewer`; `bean…`
    now means every bag of the coffee (`analysis.md` §8b). A version 2
    file's `parameter_suggestions.source` and `settings.suggestSource` are
    renamed, and a workspace on the default gets `bagRecipe`.

**Bean photos** (`bean-photos.md` §4c): `bean_photos` rows go only with
their files, so a JSON file has none (`BackupOptions.photos` in
`backend/src/backup.ts`) and a `.zip` has both (below). Exports and imports
(By list) don't carry photos.

**What was sent to the AI** (`request` on `llm_analyses` and
`parameter_suggestions`, `analysis.md` §8c) is large and only for looking
back at, so a file leaves it out unless asked (`aiRequests`,
`AI_REQUEST_COLUMNS` in `backend/src/backup.ts`). Restoring or importing
a file with it keeps it (checked like any JSON column); without it, those
rows have none. In the app, a backup, and an export of the journal or
beans (which carry analyses and suggestions), first ask "Include what was
sent to the AI?" (`frontend/src/components/AiRequestsChoice.vue`).

**Adding a table** to the schema means deciding: back it up (add it to
`BACKUP_TABLES` in insert order, any enum column to `ENUMS`, any JSON
column to `JSON_SCHEMAS`, and for a top-level table a key in `MATCH_KEYS`,
"By list" below) or leave it out (`NOT_BACKED_UP`). A test fails
until one is done, and another checks each table only points at tables
above it.

## `GET /api/workspaces/:workspaceId/backup`

- **Auth Required:** `true` (role `owner`)
- **Query:** `?aiRequests=true` also includes what was sent to the AI
  (below); `false` or left out, it isn't. `?photos=true` makes it a `.zip`
  (`backend/src/backupZip.ts`): `backup.json` (the file above, with its
  `bean_photos` rows) and `photos/<id>.webp` for each, stored as they are on
  the server. A row whose file is missing on the server is left out.
- **Success (`200 OK`):** the file above, with
  `Content-Disposition: attachment; filename="<slug>-backup-YYYY-MM-DD.json"`
  (`.zip` and `application/zip` with photos). In the app, Settings → Data →
  Back up has "Include bean photos (a .zip instead of .json)".
- **Errors:** `403` not an owner; `404` not a member.

## `POST /api/workspaces/restore`

- **Auth Required:** `true` (anyone signed in; they own the new workspace)
- **Body** (up to 50 MB, unlike the usual 100 kB):
  `{ "name": "Home bar", "slug": "home-bar", "backup": { ...file } }`.
  `name` and `slug` follow §2's rules. **Or a `.zip` backup** as it is
  (`Content-Type: application/zip`, up to 250 MB), with `?name=…&slug=…`.
  Only `backup.json` (≤ 50 MB) and `photos/<id>.webp` (≤ 5 MB each) are
  unpacked; anything else in the zip is ignored. A photo row restores only
  with a file that's a WebP inside 1024 px (its real size is used); others
  are left out, as are all photo rows of a JSON file. The photo files are
  written inside the restore, so a failed restore leaves none. The restore
  form takes either file.
- **What happens:** the whole file is checked first (format, version, every
  table and column known, values of the column's type, enum values, every
  reference pointing at a row in the file). Then, in one transaction:
  - a new workspace with that name and slug, the file's settings, menu
    title and currency, the public menu **off**, and the caller as its only
    member (owner). The default lists a new workspace gets (§2) are **not**
    added: the file has the workspace's own;
  - every row inserted with a new ID and its references rewritten; archive
    dates, positions and "date added" (`createdAt`) are kept;
  - every brew, and every suggestion's `requestedBy`, belongs to the caller
    (`brewedBy` is only kept in the file).
- **Success (`201 Created`):** `{ "workspaceId": "uuid" }`
- **Errors:** `400` the first problem found (for a zip, also "Not a zip
  file that can be read" or "The zip has no backup.json"), e.g.
  `"tables.recipes[3].brewerId: not in the file"` or
  `"backup.version: made by a newer version of the app; update this server
  first"`; `409` `"Slug already taken"`, or the file repeats a name a
  workspace keeps unique (two grinders called "C40"); `413` larger than 50
  MB. Nothing is created on an error.

## By list

An **export** is a backup file holding only some lists (or some of their
items) and everything they need; an **import** brings a file's lists into
the **current** workspace. A whole backup can be imported a list at a time
too. Where the app offers them: "Where it is" above. Code:
`backend/src/listImport.ts`.

- **Lists:** `beans`, `recipes`, `drinks`, `ingredients`, `brewers`,
  `grinders`, `water_profiles`, `prep_tools`, `brew_problems`, `brew_logs`
  (the journal).
- **The file** is the backup format above plus `"scope": "lists"` and
  `"lists": [...]`. Besides the chosen rows it holds their child rows
  (steps, grind starting points, freezes, a drink's ingredients, a brew's
  marks, prep and problem ticks, AI analyses) and, repeatedly, every row
  they point at: a recipe's brewer, style and grinders, the brewer's method,
  a drink's recipe and ingredients, a brew's bean, recipe, grinder, water,
  drink, prep items and problems. Nothing else (no menu, no other lists). It's
  worked out from each table's references (`TABLE_INFO`), so a new
  reference comes along by itself:

  | List | Its own rows | Comes along (and what that needs in turn) |
  | --- | --- | --- |
  | `beans` | beans, bean freezes | bean process |
  | `recipes` | recipes, steps, grind starting points, default prep | brewer (→ brewer method), recipe style, default grinder, the grinders of its starting points, its prep items |
  | `drinks` | drinks, drink ingredients | drink category, the drink it's a variant of, default recipe (→ as recipes), ingredients |
  | `ingredients` | ingredients | – |
  | `brewers` | brewers | brewer method |
  | `prep_tools` | prep items, the brewers each is offered for | those brewers (→ as brewers) |
  | `grinders`, `water_profiles`, `brew_problems` | themselves | – |
  | `brew_logs` | brews, their marks, prep and problem ticks, AI analyses | bean (→ as beans), recipe (→ as recipes), grinder, water profile, drink (→ as drinks), brewer, prep items, brew problems |
- **Matching** (`MATCH_KEYS`): a row is "already here" when the workspace
  has one with the same key, and the import uses that one instead:
  - by name (case-insensitive) for brewers, grinders, water profiles, prep
    items, brew problems, ingredients, drink categories, menu sections,
    roasting machines and green coffees;
  - roasts by when they were roasted and their green coffee;
  - brewer methods and bean processes by built-in key or name; recipe
    styles by method and built-in key or name;
  - beans by roaster, name, batch and roast date (two bags of the same
    coffee roasted on different days are two beans; a bean exported before
    its roast date was set no longer matches once it has one); recipes by
    name and brewer; drinks by name and kind;
  - brews by time, bean and dose, so a journal imported twice isn't
    doubled.
  A child row comes with its parent when that's added, and is left out when
  the parent is already here.
- **Duplicates:** `"existing"` (default) uses what's here; `"copy"` adds the
  chosen lists' items again, renamed `"House V60 (2)"` (a bean's bean name
  gets the number, the roaster stays: `"Test Bean (2)"`). What they need is
  still reused, and brews are never copied.
- Added rows get new IDs, the importer as their brewer, and keep archive
  dates and "date added"; an added water profile is never the default.

**Adding a list** (a new top-level table people should export and import on
its own): it must already be backed up (above, with its `MATCH_KEYS`
entry). Then add its table name to `LISTS` in `backend/src/listImport.ts`
and in `frontend/src/api/backup.ts`, its name to `LIST_LABELS`
(`frontend/src/lib/backup.ts`), and on its list page a `ListDataBar` with
`list`, `noun`, the page's `useSelection()` and `@imported` reloading the
page. Update the "Where it is" and "What comes along" tables here.

### `POST /api/workspaces/:workspaceId/export`

- **Auth Required:** `true` (role `owner`)
- **Body:** `{ "lists": ["recipes", "drinks"], "ids": { "recipes": ["uuid"] }, "aiRequests": false }`
  (`ids` optional: only those items of a list; `aiRequests` optional, below).
- **Success (`200 OK`):** the file, as an attachment
  `<slug>-<lists>-YYYY-MM-DD.json`.
- **Errors:** `400` unknown list; `403` not an owner.

### `POST /api/workspaces/:workspaceId/import/preview` and `.../import`

- **Auth Required:** `true` (role `owner`)
- **Body** (up to 50 MB): `{ "file": { ...export or backup }, "lists":
  ["recipes"], "duplicates": "existing" | "copy" }`. `lists` defaults to
  the file's `lists`, or for a backup every list it has rows of.
- **Success (`200 OK`):** both answer the same summary; the preview writes
  nothing, the import writes it in one transaction:

  ```json
  {
    "lists": ["recipes"],
    "tables": [
      { "table": "grinders", "added": ["Ode"], "matched": [{ "name": "C40", "existing": "c40" }] },
      { "table": "recipes", "added": ["House V60"], "matched": [] }
    ],
    "details": { "recipe_steps": 1, "recipe_grind_settings": 2 }
  }
  ```

- **Errors:** `400` a bad file (as for restore) or a list the file doesn't
  have; `403` not an owner; `409` the file repeats a name a workspace keeps
  unique. Nothing is written on an error.

## CSV

For spreadsheets: the journal or the beans, one row each, names instead of
IDs. For reading only; moving data between workspaces is the JSON export.
Offered on Settings → Data only. Code: `backend/src/csv.ts`.

### `GET /api/workspaces/:workspaceId/csv/:list`

- **Auth Required:** `true` (role `owner`)
- **`list`:** `brew_logs` or `beans` (anything else is `404`).
- **Success (`200 OK`):** `text/csv; charset=utf-8`, as an attachment
  `<slug>-journal-YYYY-MM-DD.csv` or `<slug>-beans-…`. RFC 4180 with CRLF
  line ends and a UTF-8 byte-order mark (so Excel reads accents); text a
  spreadsheet would run as a formula (starting `=`, `+`, `-` or `@`) gets a
  leading `'`. Yes/no columns are `yes` / `no`; empty means not recorded.
  - **Journal**, newest first: date (the brewing device's local time) and
    UTC, brewed by (email), roaster, bean, batch, recipe, style, brewer,
    drink, size, grinder, grind setting, RPM, water profile, dose, water,
    yield, ratio, TDS, extraction (worked out as in §6), water temperature,
    time (seconds and m:ss), beans in / grounds out, steeping, steeped in,
    steep window, target finish, dilution, prep and problems (`; `
    between), rating, flavors (the wheel's labels, `; ` between), tasting
    notes, drink rating, drink notes.
  - **Beans**, newest first: roaster, bean, batch, process, roast level,
    detailed roast level, roast type, roast date, blend, decaf, origin,
    country, region, altitude, producer, flavor profile, bag and stock
    weight, price, currency, purchased, green supplier, website, rating,
    notes, number of brews, archived date, date added.
- **Errors:** `403` not an owner; `404` not a member or an unknown list.
