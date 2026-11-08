# 3h. Notes

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

Titled notes per workspace (Bar setup → Notes) for what gets looked up again
and again but isn't a brew, bean or recipe: a descaling routine, how much
cleaning powder for a full tank, a burr-cleaning routine. Every member reads
them; owners and baristas write them.

A note is a list of **blocks**, in order, mixed freely:

- **Text**, formatted like an AI chat reply (the markdown subset in
  `frontend/src/lib/markdown.ts`: headings, lists, quotes, code, tables,
  bold, italic, links), drawn as elements, never HTML.
- **Calculators**: named inputs with defaults, and results worked out from
  them by formula ("Descaler powder = water * per_litre"), in order, so a
  result can use the ones above it. Formulas are worked out by the page
  (`frontend/src/lib/calc.ts`, never `eval`): numbers, keys, `+ − * / % ^`,
  parentheses, and `round(x, decimals?)`, `floor`, `ceil`, `abs`, `sqrt`,
  `min`, `max`. Keys match ignoring case. Anyone who can read the note can
  type into its inputs; what they type stays on their device (per note and
  block) and never changes the note. The editor won't save a calculator
  whose formulas don't work out; the API only checks their length, and the
  page shows an error for one it can't work out.

The page searches titles, text and calculators (their titles and labels),
lists pinned notes first, and expands a note to its blocks. Pinning is the
workspace's: a note pinned by one member is pinned for everyone.

Notes are in backups and export or import by list (§2b), matched by title.
The AI never sees them (not in analysis, suggestions or chat, §9).

**Note object:**

```json
{
  "id": "uuid",
  "title": "Descaling the espresso machine",
  "blocks": [
    { "id": "b1", "type": "text", "text": "Portafilter out. Rinse **twice**." },
    {
      "id": "b2", "type": "calculator", "title": "Descaler",
      "inputs": [
        { "key": "water", "label": "Water in tank", "unit": "L", "value": 1.8 },
        { "key": "per_litre", "label": "Strength", "unit": "g per L", "value": 20 }
      ],
      "results": [
        { "key": "powder", "label": "Descaler powder", "unit": "g", "formula": "water * per_litre", "decimals": 0 }
      ]
    }
  ],
  "pinnedAt": null, "createdAt": "…", "updatedAt": "…"
}
```

- `title`: trimmed, 1–100 chars, unique per workspace (case-insensitive).
- `blocks`: 0–50, in order, replaced as a whole; each `id` (1–36 chars,
  the client makes it) once in the note. The page remembers what was typed
  into a calculator by it, so keep it when editing.
  - text: `text` kept as written (line breaks included). 20 000 characters
    of text in all the note's text blocks together.
  - calculator: `title` 0–100 chars; 1–20 `inputs` and 1–20 `results`.
    Each has a `key` (a letter or `_`, then letters, digits or `_`, up to
    32; each once in the calculator, ignoring case, inputs and results
    together), a `label` (1–60) and a `unit` (0–20, `""` for none). An
    input's `value` is its default (−10⁹ to 10⁹); a result has a `formula`
    (1–300 chars) and `decimals` (0–6) to show.
- `pinnedAt`: when it was pinned, `null` if it isn't.
- `updatedAt`: the last change to its title, blocks or pin.

Migration 0105 made the table with a `body` (text only); 0106 turned each
body into one text block (an empty one into no blocks) and 0107 dropped it.
Notes with a body never left the `dev` branch, so backups have no upgrade
for them.

## `GET /api/workspaces/:workspaceId/notes`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "notes": [ { ...note } ] }`: pinned ones first
  (most recently pinned first), then the rest by `updatedAt`, newest first.

## `POST /api/workspaces/:workspaceId/notes`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "title": "Descaling the espresso machine", "blocks": [ … ] }`
  (`blocks` optional, default `[]`). Not pinned. Requests may be up to 1 MB
  (the API's default is 100 kB).
- **Success (`201 Created`):** `{ "note": { ...note } }`
- **Errors:** `400`; `403` viewer; `409` title taken.

## `PATCH /api/workspaces/:workspaceId/notes/:noteId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of `title`, `blocks`, and `"pinned": true |
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
