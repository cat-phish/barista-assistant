# 2. Workspaces

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

## `POST /api/workspaces`

Creates a workspace, adds the caller as `owner`, and seeds the default brew
brewers (`DEFAULT_BREWERS` in `docs/schema.md`) in one transaction.

- **Auth Required:** `true`
- **Body:** `{ "name": "Jordan's Coffee Bar", "slug": "jordans-coffee-bar" }`
  (slug: lowercase letters, digits and hyphens, 3–64 chars)
- **Success (`201 Created`):**
  ```json
  {
    "workspace": {
      "id": "uuid",
      "name": "Jordan's Coffee Bar",
      "slug": "jordans-coffee-bar",
      "isPublicMenuEnabled": false,
      "settings": { "recipeRoastLevel": "light", "roastScale": "names" },
      "createdAt": "2026-10-18T00:00:00.000Z"
    }
  }
  ```
- **Errors:** `400` invalid body; `409` slug already taken.

## `GET /api/workspaces`

- **Auth Required:** `true`
- **Success (`200 OK`):** `{ "workspaces": [ { ...workspace, "role": "owner" } ] }`
  (only workspaces the caller belongs to)

## `PATCH /api/workspaces/:workspaceId`

Updates workspace settings: the name, the web address (slug), and turning
the public menu on or off. Used by Settings → Workspace.

- **Auth Required:** `true` (role `owner`)
- **Body:** any non-empty subset of
  `{ "name": "New Name", "slug": "new-name", "isPublicMenuEnabled": true }`
  (slug: same rule as `POST`)
- **Success (`200 OK`):** `{ "workspace": { ...workspace } }`
- **Errors:** `400` invalid or empty body; `403` not an owner; `409` slug
  already taken.

> Changing the slug moves the public menu: `/menu/<old-slug>` returns `404`
> from then on (no redirect), so printed QR codes stop working. The frontend
> warns before saving.

## Settings

Every workspace in a response carries `settings`, defaults filled in
(roadmap: Units and defaults):

- `recipeRoastLevel` (`light` … `dark`, default `light`): the roast the
  workspace's recipes are written for. The recipe form's yield estimate
  uses it, a bean's roast adjusts a recipe's expected yield relative to it,
  and beans with no roast level are assumed to be it.
- `roastScale` (`names` | `levels`, default `names`): how beans record their
  roast. `names`: the roast name (`detailedRoastLevel`, Cinnamon … French),
  which sets the 5-step level. `levels`: the 5-step `roastLevel` only
  (`docs/api/beans.md` §4 already accepts it alone with a `null` name).
  Names recorded earlier stay stored but aren't shown: the bean list shows
  the level, and the public menu and preview send `detailedRoastLevel: null`
  (`docs/api/public-menu.md` §7).
- `hiddenFields` (array of field keys, default `[]`): the optional form
  fields the workspace hides (see **Field visibility** below). Each key is
  `brew.…`, `bean.…` or `recipe.…` (`^(brew|bean|recipe)\.[a-zA-Z]+$`),
  each at most once, at most 100. A `PATCH` sends the whole list. Keys are
  checked by shape, not against a list, so a key the frontend doesn't
  know just hides nothing.
- `aiHidden` (array of AI detail keys, default `[]`): what the AI doesn't
  get when it analyzes a brew, set under Settings → **AI**. Keys are
  `AI_DETAILS` (`@barista/shared/aiDetails`), each at most once; an unknown
  key is a `400`. A `PATCH` sends the whole list. What each key does is in
  `docs/api/llm-contract.md` §9, "What the AI sees".
- `autoAnalyze` (boolean, default `false`), `autoAnalyzeDelayMinutes` (`0`,
  `5`, `10`, `15` or `30`, default `10`; `0` analyzes right away), `autoAnalyzeDailyCap` (integer 1–500,
  or `null` for no cap, default `null`): auto-analyze (`docs/api/analysis.md`
  §8), set under Settings → **AI**.
- `suggestSource` (one of `bag`, `bagRecipe`, `bagBrewer`, `bean`,
  `beanRecipe`, `beanBrewer`, `brewer`, `recipe`; default `beanRecipe`, every
  bag of the coffee; workspaces from before migration 0074 have `bagRecipe`) and `suggestMaxBrews` (integer 1–20,
  default `5`): which earlier brews "Suggest parameters" sends, and at most
  how many, unless the request says otherwise (`docs/api/analysis.md` §8b),
  set under Settings → **AI**.
- `suggestAlternatives` (each of `recipe`, `brewer`, `bean` at most once;
  default `[]`): what else "Suggest parameters" suggests by default, ticked
  to start with on the brew page (§8b), set under Settings → **AI**.
- `readLabels` (boolean, default `true`): whether the bean form offers
  "Fill in from a photo", which sends label photos to the AI provider
  (`docs/api/bean-label.md` §4d), set under Settings → **AI**. Off, the
  route answers `403`.
- `labelWebLookup` (boolean, default `false`): whether that card offers
  "Also look it up on the web" (the label's text goes to a web search;
  bean-label.md §4d), set under Settings → **AI**. Off, a `web` read is a
  `403`.

### Field visibility

Settings → **Fields** lets owners hide the optional fields of the brew
(setup and log), bean and recipe forms that the bar doesn't use. Everyone in
the workspace sees the same forms.

- The fields are listed once, in the frontend's registry
  `frontend/src/lib/fields.ts` (`FIELDS`: key, form, label). The forms
  and the Settings page both read it. Required fields aren't in it, so they
  can't be hidden, and neither are a brew's rating and tasting notes, which
  the AI analysis works from.
- Hiding only changes the forms. Recorded values stay stored and are sent
  back unchanged, history views still show them, and the AI still gets them
  (choosing what the AI sees is a backlog item, "Choose what the AI sees"). A hidden field still shows when a
  form opens on a record that has a value in it (`useFieldVisibility`'s
  `reveal`), so nothing recorded is invisible while editing.
- **Every new optional field on the brew, bean or recipe forms must get an
  entry in `lib/fields.ts`** and be wrapped in `show('<key>')` in its form,
  so it can be hidden like the rest. A brew field also decides what a
  repeat does with it (`REPEAT_FOR_FIELD`, `docs/api/auth.md` §1
  repeatKeeps).

### `PATCH /api/workspaces/:workspaceId/settings`

- **Auth Required:** `true` (role `owner`)
- **Body:** any non-empty subset of the settings; unknown keys are `400`.
  Merged into what's stored.
- **Success (`200 OK`):** `{ "settings": { ...all of them } }`
- **Errors:** `400` invalid, empty or unknown keys; `403` not an owner.

## `DELETE /api/workspaces/:workspaceId?confirm=<slug>`

Permanently deletes the workspace and everything in it: members, brewers,
beans, recipes, brew logs and analyses.

- **Auth Required:** `true` (role `owner`)
- **Query:** `confirm` must equal the workspace's `slug`.
- **Success (`204 No Content`)**
- **Errors:** `400` `confirm` missing or not equal to the slug; `403` not an
  owner.

> **Frontend requirement:** ask the owner to type the workspace slug (like
> GitHub's "type the repository name") and pass exactly what they typed as
> `confirm`. Never fill it in automatically.

## Members

There is no email delivery, so "inviting" adds an already-registered user
directly by email.

### `GET /api/workspaces/:workspaceId/members`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):**
  ```json
  { "members": [ { "userId": "uuid", "email": "a@b.com", "role": "owner" } ] }
  ```
  Sorted by email.

### `POST /api/workspaces/:workspaceId/members`

- **Auth Required:** `true` (role `owner`)
- **Body:** `{ "email": "barista@example.com", "role": "barista" }` (role is
  `owner`, `barista` or `viewer`)
- **Success (`201 Created`):** `{ "member": { "userId": "uuid", "email": "...", "role": "barista" } }`
- **Errors:** `400` invalid body; `403` not an owner; `404` no registered user
  with that email; `409` already a member.

### `PATCH /api/workspaces/:workspaceId/members/:userId`

- **Auth Required:** `true` (role `owner`)
- **Body:** `{ "role": "viewer" }`
- **Success (`200 OK`):** `{ "member": { "userId": "uuid", "email": "...", "role": "viewer" } }`
- **Errors:** `400` invalid body; `403` not an owner; `404` that user is not a
  member; `409` the change would leave the workspace with no owner.

### `DELETE /api/workspaces/:workspaceId/members/:userId`

Removes a member. Owners can remove anyone. Any member can remove themselves
(leave the workspace).

- **Auth Required:** `true` (role `owner`, or `:userId` is the caller)
- **Success (`204 No Content`)**
- **Errors:** `403` not an owner and not removing yourself; `404` that user is
  not a member; `409` would leave the workspace with no owner.
