# 4b. Bean Processes

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The workspace's list of how coffee is processed, offered in the bean form in
this order (Settings → Lists). Every workspace starts with the built-ins
(`DEFAULT_BEAN_PROCESSES` in `docs/schema.md`): Washed, Natural, Wet-Hulled,
Honey, Mechanically Washed, Anaerobic Fermentation, Carbonic Maceration,
Co-Fermentation, Thermal Shock, Lactic Fermentation. Beans point at one with
`processId` (§4).

- **Built-ins** keep their `builtin` key (e.g. `washed`) and can be renamed
  and hidden, but not deleted.
- **Hidden** processes are left out of the bean form's choices for new
  beans; beans that already have one keep it, and it still shows everywhere.
- **Custom** processes (`builtin: null`) can also be deleted; their beans
  lose the process.
- The public menu (§7) and the AI context (§9) get the process's **name**.

**Process object:**
`{ "id": "uuid", "name": "Washed", "position": 1, "hidden": false, "builtin": "washed" }`

## `GET /api/workspaces/:workspaceId/bean-processes`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "processes": [ { ...process } ] }`, by
  `position`, hidden ones included.

## `POST /api/workspaces/:workspaceId/bean-processes`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Yeast Inoculated" }` (trimmed, 1–100 chars, unique
  per workspace, case-insensitive). It goes last, visible, `builtin: null`.
- **Success (`201 Created`):** `{ "process": { ...process } }`
- **Errors:** `400`; `403` viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/bean-processes/:processId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of `{ "name": "...", "hidden": true }`.
  Unknown fields (including `builtin`) are rejected.
- **Success (`200 OK`):** `{ "process": { ...process } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` name taken.

## `PUT /api/workspaces/:workspaceId/bean-processes/order`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "processIds": ["uuid", …] }`: every process of the workspace
  exactly once, in the new order.
- **Success (`200 OK`):** `{ "processes": [ { ...process } ] }`
- **Errors:** `400` not exactly the workspace's processes; `403` viewer.

## `GET /api/workspaces/:workspaceId/bean-processes/:processId/usage`

What a delete would affect (README, "Archiving and deleting").

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "beanCount": 3 }`
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/bean-processes/:processId`

Custom processes only. Its beans lose the process (`processId` becomes `null`).

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace; `409` a built-in
  (hide it instead).

> **Frontend requirement:** load the usage first; when beans use it, list
> them and require "I understand" before deleting (CLAUDE.md rule 7).
