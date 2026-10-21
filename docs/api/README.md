# API & Worker Specification

The API spec, split by section so you only need to read the part you're
working on. Section numbers are unique across all the files: `§5c` always
means drinks, wherever you see it (code comments use
`docs/api/<file>.md §N`).

## Sections

| § | File | Covers |
| --- | --- | --- |
| §1 | [auth.md](auth.md) | Authentication (JWT in httpOnly Cookie) |
| §2 | [workspaces.md](workspaces.md) | Workspaces |
| §3 | [brewers.md](brewers.md) | Brewers |
| §3b | [grinders.md](grinders.md) | Grinders |
| §4 | [beans.md](beans.md) | Beans |
| §5 | [recipes.md](recipes.md) | Recipes |
| §5b | [ingredients.md](ingredients.md) | Ingredients |
| §5c | [drinks.md](drinks.md) | Drinks |
| §5d | [drink-categories.md](drink-categories.md) | Drink Categories |
| §6 | [brew-logs.md](brew-logs.md) | Brew Logs |
| §7 | [public-menu.md](public-menu.md) | Public Menu Endpoint |
| §8 | [analysis.md](analysis.md) | LLM Brew Analysis / Parameter Suggestions |
| §9 | [llm-contract.md](llm-contract.md) | Worker -> LLM Structured Output Contract |

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
