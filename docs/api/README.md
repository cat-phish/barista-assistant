# API & Worker Specification

The API spec, split by section so you only need to read the part you're
working on. Section numbers are unique across all the files: `§5c` always
means drinks, wherever you see it (code comments use
`docs/api/<file>.md §N`).

## Sections

| § | File | Covers |
| --- | --- | --- |
| §1 | [auth.md](auth.md) | Authentication (JWT in httpOnly Cookie) |
| §1b | [notifications.md](notifications.md) | Notification channels and rate-later reminders |
| §1c | [auth.md](auth.md) | Your AI prompt (per person) and the one-off note |
| §2 | [workspaces.md](workspaces.md) | Workspaces |
| §2b | [backup.md](backup.md) | Backup and Restore (a workspace as one file) |
| §3 | [brewers.md](brewers.md) | Brewers |
| §3b | [grinders.md](grinders.md) | Grinders |
| §3c | [water-profiles.md](water-profiles.md) | Water Profiles |
| §3d | [prep-tools.md](prep-tools.md) | Prep Tools |
| §3e | [brewer-methods.md](brewer-methods.md) | Brewer Methods |
| §4 | [beans.md](beans.md) | Beans |
| §4b | [bean-processes.md](bean-processes.md) | Bean Processes |
| §4c | [bean-photos.md](bean-photos.md) | Bean Photos (the bag or label; cover in the list) |
| §4d | [bean-label.md](bean-label.md) | Read the Bean Label (fill the bean form from its photos, AI) |
| §5 | [recipes.md](recipes.md) | Recipes |
| §5b | [ingredients.md](ingredients.md) | Ingredients |
| §5c | [drinks.md](drinks.md) | Drinks |
| §5d | [drink-categories.md](drink-categories.md) | Drink Categories |
| §5e | [recipe-styles.md](recipe-styles.md) | Recipe Styles |
| §6 | [brew-logs.md](brew-logs.md) | Brew Logs |
| §6b | [brew-problems.md](brew-problems.md) | Brew Problems (what went wrong, a checklist on §6) |
| §7 | [public-menu.md](public-menu.md) | Public Menu Endpoint |
| §7b | [menu.md](menu.md) | Menu Builder (sections and items for §7) |
| §8 | [analysis.md](analysis.md) | LLM Brew Analysis / Parameter Suggestions (§8b), what was sent to the AI (§8c), previews (§8d) |
| §9 | [llm-contract.md](llm-contract.md) | Worker -> LLM Structured Output Contract |
| §10 | [server.md](server.md) | Server Administration (admins, scheduled database backups) |
| §11 | [stats.md](stats.md) | Statistics (brew and bean rows for the Insights page) |

Read this file's conventions first, then only the section(s) the change
touches. For example, a new drink field needs `drinks.md`, plus `brew-logs.md`
and `public-menu.md` if brews or the menu show it.

## 0. Conventions

- All routes are prefixed with `/api` and exchange JSON.
- Error responses use the shape `{ "error": "Human-readable message" }`.
- **Authorization:** routes marked `Auth Required: true` return `401` without a
  valid session. If the user is not a member of the target workspace, the API
  returns `404` (not `403`) so workspace and resource existence is not leaked.
  A member whose role lacks permission gets `403`.
- **Roles:** `owner` and `barista` can write; `viewer` is read-only.
- Decimal columns (grams, °C) are sent and returned as JSON **numbers**
  (e.g. `15`, `18.5`, `94`). Trailing zeros are not preserved, so the frontend
  formats for display (e.g. `toFixed(1)`). The database stores them as exact
  `DECIMAL`s, and the API rejects input with more decimal places than the
  column holds instead of rounding it.
- Error responses may include extra fields alongside `error` where noted
  (e.g. `brewLogCount`).
- **Archiving and deleting.** Beans, brewers, grinders, water profiles,
  prep tools, recipes, drinks and ingredients can be **archived** (PATCH
  `"archived": true | false`, `archivedAt` in responses): they leave the
  pickers for new brews and drinks, and history keeps them. **Deleting**
  never refuses because something uses the item: what used it is unlinked
  (or, for a brewer, its recipes are deleted too). Each of these (except
  beans, §4) has `GET …/:id/usage` with the counts a delete would affect,
  and clients show them in a warning with an "I understand" checkbox before
  deleting.
