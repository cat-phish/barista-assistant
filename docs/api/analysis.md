# 8. LLM Brew Analysis / Parameter Suggestions

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

## `POST /api/brew-logs/:brewLogId/analyze`

Queues a background BullMQ job in Redis to analyze a brew log and historic
brews for that bean, returning starting parameter suggestions for the next
brew.

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
- **Getting the result:** there is no job-status endpoint. The frontend polls
  `GET /api/workspaces/:workspaceId/brew-logs/:brewLogId` (§6) until
  `latestAnalysis` is newer than when it requested the analysis (by
  `createdAt`), or uses `GET /api/beans/:beanId/suggestions`.

## `GET /api/beans/:beanId/suggestions`

Fetches the most recent `llm_analyses` record for the given bean, along with
the last 5 `brew_logs` for that bean, so the frontend "Suggest Parameters"
button can pre-fill targets when starting a new brew. `llm_analyses` has no
`beanId`; the latest analysis is found by joining through `brew_logs` and
ordering by `llm_analyses.createdAt` descending.

- **Auth Required:** `true` (any member of the bean's workspace)
- **Success Response (`200 OK`):**
  ```json
  {
    "latestAnalysis": {
      "id": "uuid",
      "brewLogId": "uuid",
      "reasoning": "Under-extracted: sour and thin at 2:30. Grind finer.",
      "suggestedGrindDelta": "finer",
      "suggestedTempDelta": 1,
      "createdAt": "2026-10-18T09:00:00.000Z"
    },
    "analyzedBrew": { ...brewLog },
    "recentBrews": [ { ...brewLog } ]
  }
  ```
  - `latestAnalysis`: the newest analysis of any brew of this bean (by
    `createdAt`), or `null` if none exists yet.
  - `analyzedBrew`: the brew log that `latestAnalysis` analyzed (the §6
    brew log object), or `null` when `latestAnalysis` is `null`. The
    suggested deltas are relative to **this** brew, which may be older than
    the newest brew or outside `recentBrews`. To pre-fill a new brew, start
    from its parameters and apply the deltas.
  - `recentBrews`: the last 5 brew logs for the bean (§6 brew log objects),
    newest first; may be empty.
- **Errors:** `404` bean not found or not in a workspace the caller belongs
  to (same message for both).
