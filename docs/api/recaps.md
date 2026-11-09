# 11c. Recaps

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

A recap is one week or month of brewing at a glance: how much you brewed and
how it rated, the best cup, caffeine and volume, coffee used, beans opened
and finished, new recipes, and the most used recipe and brewer, each next to
the period before. Backlog 18 builds it in phases:

1. **Insights → Recap** (done): the figures, worked out in the browser.
2. A banner on the brew page when one is ready (done).
3. A notification on the first day of a new period (done; notifications.md §1b, "Recaps").
4. An AI summary, off, on request or automatic (done; llm-contract.md §9f).

## Periods

`shared/src/recapPeriods.ts` (`@barista/shared/recapPeriods`, for the
worker) and its copy `frontend/src/lib/recapPeriods.ts`, held to the same
cases by `recapPeriods.test.ts`. Days are local dates (`YYYY-MM-DD`), ends
inclusive:

- **weekly:** seven days from the person's `weekStartsOn` (auth.md §1;
  Monday by default). Insights' weekly charts use the same weeks (§11, "How
  the client counts").
- **monthly:** a calendar month.

The recap a person is offered is the one **just ended**: the last whole
period before today's. Insights → Recap can step back to any earlier one,
and forward to the period in progress ("so far").

## Settings

Per person, in `users.preferences` (auth.md §1): `recaps`, `recapPeriods`,
`weekStartsOn`, `recapBanner`, `recapBannerDays`, `recapNotify`,
`recapNotifyTime`, `timeZone`, `recapAi`, `recapSeen`. Settings → Recaps
saves them as they change, with the browser's time zone. The AI summary's
choice is shown only when the workspace has AI.

With `recaps` off there's no banner, notification or automatic summary, and
Insights → Recap waits for a **Show recap** button before it loads.

## Insights → Recap

Route `/insights/recap` (`stats-recap`), query:

| Param | Meaning |
|---|---|
| `kind` | `weekly` \| `monthly`; default the first in `recapPeriods` |
| `start` | any day in the period to show (never past today's); default the one just ended |
| `mine` | `0`: everyone's brews in the workspace; default only the person's own |
| `ws` | a workspace id (the notification's link): switches to it if it's one of the person's, then leaves the address |

The Insights filters don't apply. One `GET …/stats` (§11) with `from` = the
previous period's start, `to` = this period's end, and `mine=1` unless
`mine=0`. `frontend/src/lib/recap.ts` (`recapFigures`) counts as §11's "How
the client counts" does:

- **Brews**, the days brewed on, and the previous period's count.
- **Average rating:** the coffee rating of rated brews, and the previous
  period's.
- **Best brews:** the top coffee rating, ties kept (newest first, at most
  three), with bean, recipe and brewer.
- **Caffeine ≈** (the period's total) and **volume drunk** (≈ when any brew's
  volume is estimated).
- **Coffee used:** the sum of doses.
- **Beans brewed** (most brewed first); **new beans**: bought (`purchaseDate`,
  else the day added) in the period; **finished**: archived in the period.
- **New recipes:** created in the period (the recipe lookups' `createdAt`).
- **Most brewed** recipe, and the brewer used most.

A period without brews says so; beans and recipes added in it still show.

## Banner

A small banner at the top of the brew page (setup, before a brew starts),
`frontend/src/components/RecapBanner.vue`, with the rule in
`lib/recap.ts` (`recapsDue`, `bannerFor`, `markSeen`):

- **Which periods:** for each kind in `recapPeriods`, the one just ended,
  from the day after it ends for `recapBannerDays` days (day 1 = the day
  after), and only when `recaps` and `recapBanner` are on.
- **Not once seen:** a period whose start is at or before
  `recapSeen[kind]` is skipped.
- **Only with brews:** a due period with none of the person's brews in the
  current workspace is skipped. One `GET …/stats?mine=1` covering the due
  periods tells, and only when one is due; the answer is kept until the app
  reloads.
- **What it says:** "Your weekly recap is ready.", "Your monthly recap is
  ready." or "Your weekly and monthly recaps are ready.", with a link to
  each (`/insights/recap?kind=…&start=…`).
- **Gone when:** opened (Insights → Recap showing the period just ended
  sets `recapSeen` for that kind, whichever way it was reached), dismissed
  (× sets it for every period shown), or past `recapBannerDays`. Seen is
  per person, across workspaces.

## AI summary

Shown in Insights → Recap under the figures, when the workspace has AI
and `recapAi` isn't `off`, for a period that has ended. The summary is
the caller's own, per workspace, period and scope (`mine`, or `all` with
"Only my brews" off), stored on a `recaps` row (schema.md; not backed up).

- `recapAi: "manual"`: a **Write summary** button; **Rewrite** once written.
- `recapAi: "auto"`: the notification's tick (notifications.md §1b,
  "Recaps") writes the summary for the person's own brews before sending,
  when the workspace has AI, once per row (a failure isn't retried
  automatically; Try again is). Other periods and scope `all` use the
  button.
- The card shows "Writing the summary…" while `pending` (polled every
  3 s, for up to three minutes), the summary and its highlights with
  "Written <when>", or why it failed with **Try again**. Viewers see a
  summary but can't ask for one.

### `GET /api/workspaces/:workspaceId/recaps?kind&periodStart&scope`

- **Auth Required:** `true` (any member)
- **Query:** `kind` (`weekly` | `monthly`), `periodStart` (`YYYY-MM-DD`),
  `scope` (`mine` | `all`), all required.
- **Success (`200 OK`):** `{ "recap": null }` when never asked for, else

```json
{ "recap": { "kind": "weekly", "periodStart": "2026-11-02", "scope": "mine", "status": "done", "summary": "A steady week…", "highlights": ["…", "Try …"], "error": null, "updatedAt": "2026-11-09T08:00:12.000Z" } }
```

  `status`: `none` (a row from a notification, no summary asked for),
  `pending`, `done` or `failed` (with `error`).

### `POST /api/workspaces/:workspaceId/recaps`

- **Auth Required:** `true` (owners and baristas)
- **Body:** `{ "kind", "periodStart", "scope" }`.
- **Success (`202 Accepted`):** `{ "recap": {...} }`, `pending`, the job
  queued (§9f). One already pending is returned as it is; a done or failed
  one is written again.
- **Errors:** `400` for a `periodStart` that doesn't start a period (weeks
  start on the caller's `weekStartsOn`); `409` with `code`
  `recap_ai_off` (`recapAi` is `off`), `recap_in_progress` (the period
  hasn't ended in the caller's time zone, else the workspace's, else UTC)
  or `ai_not_configured`; `503` when the queue can't be reached.
