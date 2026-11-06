# 6b. Brew Problems

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

An ordered list per workspace (Bar setup → Problems, next to Prep) of what
can go wrong while brewing: a stalled drawdown, a channeling shot, an
untared scale… It works like prep items (§3d). Brew logs record the problems
ticked (§6, `problemIds`) and the AI analysis gets their names (§9) as the
clearest clues for the next brew. The brew log form and journal edit list
them as a checklist in this order, showing the ones offered for the recipe's
method or brewer (`offeredFor` in `frontend/src/lib/prepTools.ts`, as for
prep). A brew without a recipe offers every problem. Repeating a brew never
copies them (they're noted each time; `docs/api/auth.md` §1 repeatKeeps).

The list page reorders (drag the handles, the handles' up/down arrow keys,
or the ↑/↓ buttons; changes save immediately, a failed save restores the
previous order and shows an error; viewers can't reorder) and exports or
imports (§2b, "By list"). Archived problems stay on it, behind "Show
archived", and can be reordered. Each problem's own page sets its name and
where it's offered, archives or restores it, and deletes it.

**Problem object:**

```json
{ "id": "uuid", "name": "Paper taste", "methodKinds": ["filter"], "brewerIds": ["uuid"], "position": 2, "archivedAt": null, "createdAt": "…" }
```

- `name`: trimmed, 1–100 chars, unique per workspace (case-insensitive).
- `methodKinds`: the methods it's offered for (`filter`, `espresso`,
  `stovetop`, `other`), each once.
- `brewerIds`: the brewers it's offered for on top of those methods (the
  workspace's, archived ones allowed), each once, stored in
  `brew_problem_brewers`. Deleting a brewer drops it from the list.
- Both empty = offered for every brew.
- `position`: 1, 2, 3… (the checklist order).

Migration 0098 turned each problem's old `methodKind` into a one-item
`methodKinds` (`null` became `[]`); 0099 dropped the column. Backups from
before it (version 4 and older) are upgraded the same way (§2b).

A new workspace starts with `DEFAULT_BREW_PROBLEMS` (`docs/schema.md`): ten
filter problems (slow drawdown / stalled bed, fast drawdown, uneven or
cratered bed, grounds high on the walls, channeling, filter clogged or
collapsed, poured too fast or uneven, missed a pour target, water too hot or
cold, immersion grounds didn't sink), nine espresso ones (channeling /
spurting, shot ran fast, shot choked, uneven extraction, puck wet or soupy,
puck cracked or stuck, grinder clumping, dose spilled or uneven tamp, machine
temperature not settled) and four for every method (stale or old beans, grind
setting changed by mistake, scale not tared, distracted / timer missed).
Migration 0060 gave existing workspaces the same list. Each default is
offered for its one method, or for every brew.

An **archived** problem (`archivedAt` set) leaves the checklist for new brews,
but past brews keep showing it, and it can be restored. Deleting one takes it
off the brews that recorded it (see `DELETE` below).

## `GET /api/workspaces/:workspaceId/brew-problems`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "problems": [ { ...problem } ] }` by
  `position`, archived ones included.

## `POST /api/workspaces/:workspaceId/brew-problems`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "name": "Paper taste", "methodKinds": ["filter"], "brewerIds": ["uuid"] }`
  (`methodKinds` and `brewerIds` optional, default `[]`). It goes last.
- **Success (`201 Created`):** `{ "problem": { ...problem } }`
- **Errors:** `400` (including `brewerIds` not this workspace's); `403`
  viewer; `409` name taken.

## `PATCH /api/workspaces/:workspaceId/brew-problems/:problemId`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** any non-empty subset of `name`, `methodKinds`, `brewerIds` (each
  list replaces the whole list), and `"archived": true | false` (`true` sets
  `archivedAt`, unchanged if already archived; `false` restores it).
- **Success (`200 OK`):** `{ "problem": { ...problem } }`
- **Errors:** `400` (including `brewerIds` not this workspace's); `403`
  viewer; `404` not in this workspace; `409` name taken.

## `PUT /api/workspaces/:workspaceId/brew-problems/order`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:** `{ "problemIds": ["uuid", "uuid"] }`: every problem of the
  workspace, archived ones included, exactly once, in the new order.
- **Success (`200 OK`):** `{ "problems": [ { ...problem } ] }`
- **Errors:** `400` not exactly the workspace's problems; `403` viewer.

## `GET /api/workspaces/:workspaceId/brew-problems/:problemId/usage`

What deleting it would take with it (see README, "Deleting").

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "brewLogCount": 3 }`: brews that recorded it.
- **Errors:** `404` not in this workspace.

## `DELETE /api/workspaces/:workspaceId/brew-problems/:problemId`

Brews that recorded it are kept, without it in their `problems`. Clients warn
first, from `/usage`.

- **Auth Required:** `true` (role `owner` or `barista`)
- **Success (`204 No Content`)**
- **Errors:** `403` viewer; `404` not in this workspace.
