# 3h. Notes

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Titled notes per workspace (Bar setup → Notes) for what gets looked up again
and again but isn't a brew, bean or recipe: how much cleaning powder per
litre for the espresso machine, the citric acid for descaling the kettle, a
burr-cleaning routine. Every member reads them; owners and baristas write
them. The body is formatted like an AI chat reply (the markdown subset in
`frontend/src/lib/markdown.ts`: headings, lists, quotes, code, tables, bold,
italic, links), drawn as elements, never HTML.

The page searches titles and bodies, lists pinned notes first, and expands a
note to its formatted text. A line like "20 g per 1 L" (an amount, "per" or
"/", a volume) gets a **Scale for** box that works the amount out for any
volume ("for 1.8 L: 36 g"); that's the page's own (`lib/noteScaling.ts`),
nothing is stored. Pinning is the workspace's: a note pinned by one member
is pinned for everyone.

Notes are in backups and export or import by list (§2b), matched by title.
The AI never sees them (not in analysis, suggestions or chat, §9).

**Note object:**

```json
{ "id": "uuid", "title": "Descaling the kettle", "body": "- 20 g citric acid per 1 L\n- Boil, leave 30 min, rinse twice", "pinnedAt": null, "createdAt": "…", "updatedAt": "…" }
```

- `title`: trimmed, 1–100 chars, unique per workspace (case-insensitive).
- `body`: 0–20 000 chars, kept as written (line breaks included).
- `pinnedAt`: when it was pinned, `null` if it isn't.
- `updatedAt`: the last change to its title, body or pin.

## `GET /api/workspaces/:workspaceId/notes`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "notes": [ { ...note } ] }`: pinned ones first
  (most recently pinned first), then the rest by `updatedAt`, newest first.

## `POST /api/workspaces/:workspaceId/notes`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "title": "Descaling the kettle", "body": "…" }` (`body`
  optional, default `""`). Not pinned.
- **Success (`201 Created`):** `{ "note": { ...note } }`
- **Errors:** `400`; `403` viewer; `409` title taken.

## `PATCH /api/workspaces/:workspaceId/notes/:noteId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of `title`, `body`, and `"pinned": true |
  false` (`true` sets `pinnedAt`, unchanged if already pinned; `false` clears
  it).
- **Success (`200 OK`):** `{ "note": { ...note } }`
- **Errors:** `400`; `403` viewer; `404` not in this workspace; `409` title
  taken.

## `DELETE /api/workspaces/:workspaceId/notes/:noteId`

Nothing uses a note, so there's no `/usage` and no "I understand" warning.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
