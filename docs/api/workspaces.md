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
