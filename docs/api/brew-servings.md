# 6c. Brew Servings

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

A finished long cold brew is a **batch**: stock in the fridge. A brew is
one when the style it was brewed as (its own `style`, §6, kept when the
recipe changes) brews like `cold_brew` or `kyoto_drip` (`LONG_STYLES`, `isBatchStyle`).
Without that style, its recipe copy's style decides. A brew that already
has servings stays a batch, whatever its style. Each glass
taken from it is a **serving**, with how much concentrate was poured, what
it was diluted with, and how it tasted. Insights counts a batch's servings
instead of the batch once it has any (`stats.md` §11, backlog item 14).

**Permissions:** any member can read. Any owner or barista can log a serving
from any batch and mark a batch finished or reopen it (the batch is the
workspace's stock). A serving is edited or deleted by whoever logged it, or
by an owner (`403` otherwise). Viewers are read-only.

**Serving object:**

```json
{
  "id": "uuid",
  "brewLogId": "uuid",
  "userId": "uuid",
  "loggedBy": { "id": "uuid", "email": "barista@example.com" },
  "timestamp": "2026-11-10T15:30:00.000Z",
  "utcOffsetMinutes": -420,
  "concentrateGrams": 120,
  "diluentGrams": 120,
  "dilutedWith": "water",
  "dilutionRatio": 1,
  "rating": 4,
  "tastingNotes": "Chocolatey, a little flat",
  "flavors": [{ "key": "cocoa.chocolate", "label": "Chocolate" }],
  "createdAt": "2026-11-10T15:30:05.000Z"
}
```

- `concentrateGrams`: what was poured from the jar, > 0, one decimal: the
  concentrate, or, from a batch diluted in the jar (`jarWaterGrams`), the
  diluted coffee. 1 g counts as 1 ml.
- `diluentGrams`: what it was topped up with, ≥ 0, or `null`. `null` or `0`
  is served neat.
- `dilutedWith`: one of `DILUTION_WITH` (`water`, `milk`, `ice`, `other`);
  `water` when a diluent is sent without it, `null` when neat.
- `dilutionRatio` (read-only): the glass's own, 1 : this, diluent ÷ what was
  poured, rounded to 2 decimals; `null` when neat. A jar's dilution isn't
  in it: clients work out the overall strength with the batch's yield.
- `timestamp` (default now, at most 5 minutes ahead) and `utcOffsetMinutes`
  give the serving's local day, as on brew logs (§6).
- `rating` (0.5–5 in 0.5 steps), `tastingNotes` (≤ 5000 chars) and
  `flavors` (keys on the workspace's wheel, §2c; the same rules as a brew's,
  in wheel order) are optional.
- `userId` / `loggedBy` are `null` once the person deleted their account.

**Diluted in the jar:** dilution normally happens in each glass. A batch
diluted as a whole records the water added in the brew log's
`jarWaterGrams` (§6). The jar then holds yield + that water.

The batch's stock is worked out by clients: the jar (its yield, measured or
else estimated, `frontend/src/lib/batch.ts`, plus `jarWaterGrams`) minus the
brew log's `pouredGrams`. A serving's share of the batch's caffeine is what it
poured ÷ the jar (never past the whole batch, `servingShare`).

## `GET /api/workspaces/:workspaceId/brew-logs/:brewLogId/servings`

- **Auth Required:** `true` (any member)
- **Success (`200 OK`):** `{ "servings": [ ...serving ] }`, oldest first
  (`[]` for a brew that isn't a batch).
- **Errors:** `404` brew log not in this workspace.

## `POST /api/workspaces/:workspaceId/brew-logs/:brewLogId/servings`

- **Auth Required:** `true` (owner or barista)
- **Body:** `concentrateGrams` (required), and optionally `diluentGrams`,
  `dilutedWith`, `timestamp`, `utcOffsetMinutes`, `rating`, `tastingNotes`,
  `flavors` (keys).
- **Success (`201 Created`):** `{ "serving": { ...serving } }`
- **Errors:** `400` invalid body or a flavor not on the wheel; `403` viewer;
  `404` brew log not in this workspace; `409` the brew isn't a long cold
  brew batch, is still steeping, or the batch is finished.

## `PATCH /api/workspaces/:workspaceId/brew-logs/:brewLogId/servings/:servingId`

- **Auth Required:** `true` (owner, or the barista who logged it)
- **Body:** any non-empty subset of the `POST` fields. `flavors` replaces
  the list; picks the wheel no longer has are kept as saved.
- **Success (`200 OK`):** `{ "serving": { ...serving } }`
- **Errors:** `400`; `403`; `404` brew log or serving not found; `409` the
  brew isn't a batch (it changed style) or is steeping. A finished batch's
  servings can still be edited.

## `DELETE /api/workspaces/:workspaceId/brew-logs/:brewLogId/servings/:servingId`

- **Auth Required:** `true` (owner, or the barista who logged it)
- **Success (`204 No Content`)**
- **Errors:** `403`; `404`.

## `PUT /api/workspaces/:workspaceId/brew-logs/:brewLogId/batch`

Batch finished: the batch is empty (drunk, or the rest poured out), so it
takes no more servings. What wasn't logged as a serving never counts.

- **Auth Required:** `true` (owner or barista)
- **Body:** `{ "finished": true }`, or `false` to reopen it.
- **Success (`200 OK`):** `{ "brewLog": { ...brewLog } }` (§6), with
  `batchFinishedAt` set (kept if it was already finished) or `null`.
- **Errors:** `400`; `403` viewer; `404`; `409` not a long cold brew batch,
  or still steeping.
