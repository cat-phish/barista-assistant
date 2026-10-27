# 8. LLM Brew Analysis / Parameter Suggestions

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

## `POST /api/brew-logs/:brewLogId/analyze`

Queues a background BullMQ job in Redis to analyze that one brew log (no
earlier brews are sent, §9), returning starting parameter suggestions for
the next brew.

- **Auth Required:** `true` (role `owner` or `barista` in the brew log's
  workspace)
- **Success Response (`202 Accepted`):**
  ```json
  {
    "status": "queued",
    "jobId": "bullmq-job-id",
    "message": "Brew analysis queued."
  }
  ```
- **Errors:** `404` brew log not found or not in a workspace the caller
  belongs to (same message, and the same single query, for both, so neither
  body nor timing reveals whether the log exists); `403` viewer; `409` the
  brew is a cold brew still steeping (§6: finish it first), or it has no
  rating (`rating` and `drinkRating` both `null`) and the workspace keeps
  unrated brews from the AI (`aiHidden` has `analyzeUnrated`, §9); `503` the queue
  (Redis) is unavailable.
- **Duplicates:** while a log's analysis is waiting or running, another
  request returns `202` with the **same** `jobId` and queues nothing new. Once
  that job finishes (or finally fails), the log can be analyzed again, and each
  run adds a new `llm_analyses` row.
- **While an automatic analysis waits** (auto-analyze, below): the request
  runs that job now instead of adding one (same `jobId`), as asked for, so
  the daily cap doesn't apply. Asking also clears the brew's
  `analysisDueAt` and `analysisError` (§6).
- **Getting the result:** there is no job-status endpoint. The frontend polls
  `GET /api/workspaces/:workspaceId/brew-logs/:brewLogId` (§6) until
  `latestAnalysis` is newer than when it requested the analysis (by
  `createdAt`).

## Auto-analyze

Owners switch it on under Settings → **AI** (`autoAnalyze`,
`autoAnalyzeDelayMinutes`, `autoAnalyzeDailyCap`; `docs/api/workspaces.md`
§2). Then:

- **A rated brew** saved with `POST …/brew-logs` (§6) queues an analysis
  `autoAnalyzeDelayMinutes` later (`0`: right away): a delayed job, same `jobId` as above, data
  `{ brewLogId, auto: true }`. The brew is read when the job runs, so edits
  made meanwhile are included; deleting the brew removes the waiting job.
- **An unrated brew** (Rate later, or no rating given) and a cold brew still
  steeping queue nothing. The `PATCH` that gives it its first rating (quick
  rate, edit) or finishes the steep with one queues it to run now, unless
  it already has an analysis. Brews never rated cost nothing.
- While it waits, the brew log's `analysisDueAt` (§6) says when; it's
  cleared once the analysis is saved or skipped.
- **When the job runs** it's skipped (no API call) if auto-analyze was
  switched off meanwhile, or if the workspace has made
  `autoAnalyzeDailyCap` automatic analyses in the last 24 hours; then
  `analysisError` says "Not analyzed automatically: the workspace's daily
  limit was reached". Analyses asked for are never capped and don't count.
  Saved analyses record `auto: true`.
- Queueing never fails the save: if Redis is unavailable the brew just
  isn't analyzed automatically.

**Failures:** when every attempt fails, the brew log's `analysisError`
says so ("The AI service couldn't be reached", or "The AI service refused
the request" for a rejected key or model); the worker's log has the
details. Asking again (`POST …/analyze`) clears it.

## 8b. Suggest parameters

On the brew page, before brewing: starting values for the brew being set
up (bean, recipe, grinder, batch), from the earlier brews the barista
picks, each sent with its latest analysis (§9b). The batch (how much to
brew) is the barista's: the AI keeps it and suggests a ratio for it.
Saved in `parameter_suggestions` (`docs/schema.md`), pending until the
worker fills in the result. Always asked for, so the auto-analyze cap
doesn't apply.

**Sources** (`SUGGEST_SOURCES`, `@barista/shared/schema`), newest first, at
most `maxBrews` (1–20), without brews still steeping (and without unrated
ones when the workspace keeps them from the AI, `aiHidden`
`unratedHistory`, §9):

| `source` | Brews sent |
| --- | --- |
| `bean` | this bean's, any recipe |
| `beanRecipe` | this bean's with this recipe |
| `beanBrewer` | this bean's on this brewer (`brew_logs.brewerId`) |
| `brewer` | this brewer's, any bean |
| `recipe` | this recipe's, any bean |

The workspace's defaults are `suggestSource` and `suggestMaxBrews`
(`docs/api/workspaces.md` §2, Settings → **AI**).

### `POST /api/workspaces/:workspaceId/parameter-suggestions`

- **Auth Required:** `true` (role `owner` or `barista`)
- **Body:**
  ```json
  {
    "beanId": "uuid", "recipeId": "uuid", "grinderId": "uuid", "source": "beanRecipe", "maxBrews": 5,
    "batch": { "doseGrams": 22.5, "waterGrams": 375, "iceGrams": null, "yieldGrams": null }
  }
  ```
  - `beanId` required; `recipeId`, `grinderId` optional (or `null`). The
    brewer is the recipe's; without a recipe, `brewerId` may name one.
  - `source` and `maxBrews` optional: the workspace's defaults.
  - `batch` optional: the batch as planned, each amount in grams (over 0,
    saved to 0.1 g) or `null`. Filter: dose, hot water and ice; espresso:
    dose and shot weight (`yieldGrams`). Without one the worker uses the
    recipe's targets.
- **Success Response (`202 Accepted`):** `{ "suggestion": { ... } }`, the
  row below with `status: "pending"`. Queued on `parameter-suggestion`
  (job `suggest`, data `{ "suggestionId": "uuid" }`, 3 attempts with
  backoff, like an analysis).
- **Errors:** `400` an id that isn't the workspace's, a `source` that needs
  a recipe (`beanRecipe`, `recipe`) or a brewer (`beanBrewer`, `brewer`)
  without one, a `maxBrews` out of range, an unknown key; `403` viewer;
  `404` not a member; `503` the queue (Redis) is unavailable (nothing is
  saved).

### `GET /api/workspaces/:workspaceId/parameter-suggestions/:suggestionId`

Any member. The frontend polls it until `status` is `done` or `failed`.

- **Success Response (`200 OK`):**
  ```json
  {
    "suggestion": {
      "id": "uuid", "beanId": "uuid", "recipeId": "uuid", "brewerId": "uuid", "grinderId": "uuid",
      "source": "beanRecipe", "maxBrews": 5, "brewCount": 3,
      "batchDoseGrams": 22.5, "batchWaterGrams": 375, "batchIceGrams": null, "batchYieldGrams": null,
      "status": "done", "error": null,
      "reasoning": "The last two cups were sour at 20; one step finer and a degree hotter.",
      "nextStep": "Watch the drawdown: aim to finish by 3:00.",
      "confidence": "medium",
      "grindSetting": 19, "grindRpm": null, "tempC": 95, "ratio": 16,
      "model": "gpt-…", "promptVersion": "2026-10-f",
      "createdAt": "2026-10-26T08:00:00.000Z", "completedAt": "2026-10-26T08:00:06.000Z"
    }
  }
  ```
  - `brewCount`: how many earlier brews were sent (`0`: the recipe and
    bean alone).
  - The values are for the grinder named (`grindSetting` `null` without one,
    or without a brew or starting point on it to go on); `ratio` is for the
    batch, `(water + ice) / dose` or for espresso shot weight / dose, `null`
    to keep the batch's; `grindRpm` only on a variable-speed grinder.
    Results are `null` while pending.
  - `failed`: `error` says why ("The AI service couldn't be reached", or
    "… refused the request"), shown with Try again.
- **Errors:** `404` not a member, or not a suggestion of this workspace's
  beans (same message).

The brew page fills the values in (temperature, the ratio, and the grind
when it's for the grinder chosen) and they can be changed as usual. The
ratio moves the batch around what it holds (`heldForRatio`,
`frontend/src/lib/suggest.ts`): espresso keeps the dose, which the basket
fixes, so the shot weight moves; a filter batch keeps what was typed last
(dose, water, drink size or cup), and untouched the recipe's water, so the
cup stays about the same size and the dose moves.

## 8c. What was sent to the AI

Each analysis and each suggestion keeps exactly what the worker sent:
`request`, a JSON column on `llm_analyses` and `parameter_suggestions`,
built from the request itself (`analysisSent` / `suggestionSent`,
`worker/src/llm.ts`):

```json
{ "sections": ["core", "output", "…", "end"], "system": "You are an expert…", "input": { "bean": { "…": "…" }, "brew": { "…": "…" } } }
```

- `sections`: the prompt sections it was built from (`docs/api/llm-contract.md`
  §9 and §9b), in order; `system`: the system prompt as sent; `input`: the
  user message, as JSON.
- `null` on analyses made before it was saved, on a suggestion until it's
  done, and after a restore or import of a file without it.
- It's large (often 10-30 KB), so rows are returned without it: an
  analysis (`latestAnalysis`, §6) and a suggestion (§8b) carry
  `"hasRequest": true | false` instead, and it's read on its own.
- Backups and exports leave it out unless asked (`docs/api/backup.md` §2b,
  "What was sent to the AI").

### `GET /api/brew-logs/:brewLogId/analyses/:analysisId/request`
### `GET /api/workspaces/:workspaceId/parameter-suggestions/:suggestionId/request`

- **Auth Required:** `true` (any member)
- **Success Response (`200 OK`):** `{ "request": { ... } }`, or
  `{ "request": null }` when there's none.
- **Errors:** `404` not a member, or not an analysis of that brew / a
  suggestion of this workspace's beans (same message).

The journal's analysis card and the brew page's Suggest parameters card
have **What was sent to the AI** (`frontend/src/components/AiRequestDialog.vue`):
the section keys, the system prompt, and each part of the input folded.
