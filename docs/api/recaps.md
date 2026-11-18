# 11c. Recaps

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

A recap is one week, month or year of brewing at a glance: how much you brewed and
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
- **yearly:** a calendar year, 1 January to 31 December: the Yearly tab
  (below). Your Year in Coffee has its own window (below).

The recap a person is offered is the one **just ended**: the last whole
period before today's. Insights → Recap can step back to any earlier one,
and forward to the period in progress ("so far").

## Settings

Weekly, monthly and yearly recaps always exist; nothing turns them off.
Per person, in `users.preferences` (auth.md §1): `weekStartsOn`,
`recapBanners`, `recapBannerDays`, `recapPushes`, `recapNotifyTime`,
`timeZone`, `recapAutoSummaries`, `recapSeen`. Settings → Recaps saves them
as they change, with the browser's time zone.

The three switch objects are per kind: `weekly`, `monthly`, `yearly` and
`yearInCoffee` (Your Year in Coffee), shown as a grid with a **Banner**,
**Push** and **AI summary** column. Banner days and push time are shared.
The AI summary column shows only when the workspace has AI. Off, a recap
still has its **Write summary** button; with no AI set up, neither the
column nor the button shows (the rule for every AI button). All four
kinds have a banner (below), a push (notifications.md §1b, "Recaps") and
an automatic summary (Your Year in Coffee's is written by the worker right
after it freezes the year on 7 December). The yearly push goes on
1 January together with the monthly one; Your Year in Coffee's on
7 December.
Your Year in Coffee is frozen on 7 December whatever they say.

## Insights → Recap

Route `/insights/recap` (`stats-recap`), query:

| Param | Meaning |
|---|---|
| `kind` | `weekly` \| `monthly` \| `yearly` (tabs Weekly, Monthly, Yearly); default `weekly` |
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
  volume is estimated): your share only, as Insights counts it (stats.md
  §11, "Who drank it").
- **Brewed for others:** brews made at least partly for guests, their share
  of the volume, and who they were (named guests most brewed for first,
  then other guests). Left out when there were none. The AI summary gets
  only the count (`brewsForOthers`, llm-contract.md §9f), no names.
- **Coffee used:** the sum of doses.
- **Beans brewed** (most brewed first); **new beans**: bought (`purchaseDate`,
  else the day added) in the period; **finished**: archived in the period.
- **New recipes:** created in the period (the recipe lookups' `createdAt`).
- **Most brewed** recipe, and the brewer used most.

A period without brews says so; beans and recipes added in it still show.

## Your Year in Coffee

Backlog 65: the year's brewing from **1 January to 6 December**, as story
slides, out on **7 December** (December's last weeks aren't counted, as
Spotify Wrapped doesn't). The Yearly tab (above) is the whole calendar year,
live; Your Year in Coffee is a **frozen copy**. Built in phases:

1. **The year's figures** (done): counted on the server by
   `@barista/shared/yearInCoffee` (`freezeYear`) from the Insights rows
   (`@barista/shared/statsRows`, exactly what `GET …/stats` sends) and
   frozen (below). Later edits to brews or beans don't change a frozen year.
2. **The story slides** (done), and an entry on Insights → Recap.
2b. **Motion and sound** (done, but the built-in track itself is still to
   be picked): animation, the music picker, and your own song where the
   server allows uploads (`auth.md` §1, "Year song").
3. A shareable image of the summary card.
4. **Its own AI summary**, written to be shared; the Yearly tab's (kind
   `yearly`) is a separate one. It sits on the frozen copy's row (kind
   `yearInCoffee`, `periodStart` 1 January, per scope) and uses the same
   routes as a recap's: `GET`/`POST …/recaps` with `kind: "yearInCoffee"`
   (400 unless `periodStart` is 1 January; 409 `year_not_out` before
   7 December; any past year, frozen or not). It covers 1 January–
   6 December against the same dates a year before, sends the months'
   summaries for January to November, and, with a frozen copy, its
   highlights (llm-contract.md §9f). With the `yearInCoffee` AI summary
   switch on and AI set up, the worker writes it straight after freezing
   (`processYearFreeze`), once per row: one written by hand first stands.
   On the slides it's an "in a few words" slide before the summary card,
   shown once written, or to someone who can write it (Write summary);
   only with a model.
5. The banner from 7 December to the year's end (until opened or
   dismissed) and a push on 7 December (notifications.md §1b, "Recaps").

**Figures:** everything a recap counts for 1 January–6 December, next to
the year before's same dates (above, including your share of volume and
caffeine and Brewed for others), plus:

- **Brews per month**, January first.
- **Longest streak:** the longest run of days brewed in a row (2 or more).
- **Busiest month, weekday and favourite hour** (local time), from 5
  brews; the busiest month needs brews in 2 months or more. Ties go to the
  earliest.
- **Top origins** (a bean's countries, a blend's each counted), **roasters,
  processes, varieties and flavors** (picked on the wheel, by label), most
  brewed first, at most 5 each. A list needs 2 different entries or it's
  left out.
- **Most improved:** the recipe or bean whose rating rose most from the
  first half of its rated brews to the last half, with 4 rated brews or
  more and a rise of half a star or more.
- **Who brewed** (the bar's year, with "Only my brews" off): each person's
  brews, most first, and whose brew was the best cup; left out when only
  one person brewed. "You", others by their name (auth.md §1, "Name"),
  and anyone without one "Member 1", "Member 2"… by most brews; never an
  email.

A figure without enough behind it is left out, so its slide is skipped.

**Frozen** (`@barista/shared/yearFreeze`): kept on a `recaps` row, kind
`yearInCoffee`, `periodStart` 1 January, per person, workspace, year and
scope (`mine`, and `all` for the bar's), in its `figures` column: `{ version,
period, figures, history }`, with the earlier years to compare with
(`history`) frozen alongside. The worker's quarter-hourly recap tick
freezes them once a person's own day (their time zone, as recaps follow)
reaches 7 December: `mine` for everyone who brewed from 1 January to
6 December, `all` for every member of a workspace someone brewed in, at most
50 a tick, through 31 December (so a member who joins later gets theirs).
Only the worker freezes: opening a year with no frozen copy (a year from
before this existed, or before the tick got to you) counts it then, same
dates, and saves nothing, so it follows later edits. Once frozen it is
never counted again. In a backup (`backup.md` §2b) and restored as it
was; only the restorer's own, like summaries. A bar's copy frozen in a zone
that reaches 7 December first can miss a colleague's brew from late on
6 December in a zone behind it.

`version` (`YEAR_FIGURES_VERSION`) goes up when a figure is added or changes
meaning. A copy frozen before a figure existed doesn't have it: the page
reads a missing figure as empty (`completeFigures` in
`frontend/src/lib/yearInCoffee.ts`) and skips its slide; old years aren't
counted again.

**Parity with the Yearly tab:** the Yearly tab counts live in the browser
(`frontend/src/lib/recap.ts`); Your Year in Coffee's `recap` part is the
server's copy of that counting. **They must match: a figure added to,
changed in or removed from one is done in the other in the same change**,
with `YEAR_FIGURES_VERSION` bumped (CLAUDE.md rule 15).
`frontend/src/lib/yearInCoffee.parity.test.ts` runs both on the same rows
and fails when they differ or one has a figure the other lacks. What only a
year has (streak, origins, most improved, …) is counted on the server only.

### `GET /api/workspaces/:workspaceId/recaps/year-in-coffee/:year?scope`

Any member. `scope`: `mine` or `all`. Returns `{ year: { version, period,
figures, history }, frozen }`: the frozen copy (`frozen: true`), or with
none the year counted now and not saved (`frozen: false`).
`409 year_not_out` for this year before 7 December in the caller's time
zone (or a later year); `400` for a bad year or scope.

**Slides:** route `/insights/year` (`stats-year`), full screen outside the
Insights tabs, linked from the top of Insights → Recap ("Your 2025 in
coffee", "1 January to 6 December"). Query: `year` (default and latest:
this year from 7 December, else last year; never one in progress) and
`mine=0` for the bar's year (an **Only my brews** box on the slides, on by
default). One `GET …/recaps/year-in-coffee/:year`.

- One figure per slide (`frontend/src/lib/yearSlides.ts`): the year;
  brews; longest streak; busiest month (with brews per month); the usual
  weekday and hour; coffee used; volume drunk and caffeine; brewed for
  others; top beans, origins, roasters, processes, varieties and flavors;
  most brewed recipe; best cup (with a link to it); most improved; new
  beans and recipes; who brewed; then a **summary** with the year's key
  lines and the years before and after. A year without brews has only
  the first slide and "No brews".
- Next: tap the right two-thirds, swipe left, → or Page Down, or the ›
  button. Back: the left third, swipe right, ← or Page Up, ‹. Escape or
  ✕ closes. A progress bar shows where you are. Slides slide in, except
  with `prefers-reduced-motion`.

**Motion and sound:** each slide's number counts up over 0.9 s when it
starts with one ("120 brews", "≈ 30 l"; not the year on the first slide),
`frontend/src/lib/countUp.ts`; screen readers get the final value only.
Month bars grow in, list rows step in 60 ms apart, and the summary drops
confetti (CSS only). With `prefers-reduced-motion`, nothing moves or
counts: every slide shows as it ends.

**Compared with earlier years** (`frontend/src/lib/yearCompare.ts` words
the chips): the frozen copy's `history` has every earlier year with brews,
each counted the same way over the same dates, 1 January–6 December. Chips under a figure
compare it with last year ("+5% on 2025"), and with an average year or, when
the year beats every earlier one, a record ("Your biggest year yet"):
brews, longest streak, coffee used, average rating (in stars, last year or
a record only), volume drunk, brews for others, how many origins and
roasters (with "2 new to you": never brewed before), and whether the top
bean or recipe was last year's too. The summary shows last year's change
beside days brewed, coffee used, volume and streak. Rules: an earlier year
counts with 5 or more brews (rated brews for the rating); an average or a
record needs 2 such years; within ±2% is "About the same"; 2× or more is
written as a multiple; ratings to 0.1 ★. Up is in the
brand colour, down stays muted. Only my brews compares you with you, the
bar with the bar. A slide with chips stays 1 s longer.

A first year someone joined after January is **partial**: its covered days
run from its first brew to the period's end. Totals (brews, coffee, volume,
brews for others, days brewed) are scaled to the full period and its
last-year chip says so: "+12% on 2024's pace" (screen readers hear "2024
started on 1 Oct, scaled to a full year"). The streak and how many origins
and roasters can't be scaled, so a partial year isn't compared on them; the
rating and the top bean or recipe compare as they are. Under 30 covered
days it isn't compared at all. Its names still count for "new to you".

**Moving on:** each slide moves on by itself once it has had time to be
read (`slideDuration` in `frontend/src/lib/yearSlides.ts`: 4 s for the
first, 5 s for the others, plus 1.5 s with a line under the figure and
0.7 s per list row, at most 12 s); its bar in the progress strip fills as
it runs. It stops on the summary. The pause button in the top bar, beside mute, pauses it (play goes on),
and so does holding a finger or the mouse on the slide, as in stories:
the slide, its animation and the music stop, and the top and bottom bars
fade out after a moment, until you let go (letting go isn't a tap). A
hidden tab or loading pauses it too. Taps, swipes and arrow keys still move at
once, and the new slide's time starts afresh.

Music: one song, your own where the server allows uploads and you have
one (`auth.md` §1 "Year song", uploaded under Settings → Recaps), else the
built-in. It starts unmuted when Settings → Recaps → Your Year in Coffee →
Play music is on (`yearMusic`, `auth.md` §1; off by default); the mute
button in the top bar mutes it for that viewing only. The built-in song is a CC0 (public domain)
track, `frontend/public/music/year-in-coffee.mp3`, its source in
`CREDITS.md` beside it; CC0 waives all rights, so it sits fine in this AGPL
app. It loops at 60% volume on one player shared by the app
(`frontend/src/lib/yearSong.ts`), since browsers allow sound only inside a
tap: tapping the banner's link or the Insights "in coffee" card starts it
from the beginning in that tap, then opens the slides. Opened any other way
(a push, a shared link, a reload) with the music on, the slides wait on a
"Tap to start" cover (Enter or Space too); muting skips it, and unmuting
starts the song straight away. It pauses while
the tab is hidden, the slide is held or paused, fades out over 0.6 s on
close and stops when the slides do.

**Sharing.** The summary slide has a **Share** button: the summary card
(kicker, brews, its lines with the change on last year, and a footer with
the app's name, the workspace's too on the bar's year) drawn on a 1080×1920
story-size canvas (`frontend/src/lib/yearImage.ts`, reusing
`lib/chartImage.ts`) in the page's colours. It's drawn as the summary slide
shows, so the tap goes straight to the share sheet (Web Share API with a
file, most phones); where files can't be shared, or the sheet refuses, it
downloads as `your-2025-in-coffee.png` ("Image saved"). Closing the sheet
does nothing. `drawYearCard` draws on any 2D context and size, for the
video (backlog 68). The AI summary isn't on it.

## Banner

A small banner at the top of the brew page (setup, before a brew starts),
`frontend/src/components/RecapBanner.vue`, with the rule in
`lib/recap.ts` (`recapsDue`, `bannerFor`, `markSeen`):

- **Which periods:** for each recap kind whose `recapBanners` switch is
  on (weekly, monthly, yearly), the one just ended, from the day after it
  ends for `recapBannerDays` days (day 1 = the day after). Your Year in
  Coffee (its switch on) from 7 December to 31 December, whatever
  `recapBannerDays` says, for 1 January–6 December.
- **Not once seen:** a period whose start is at or before
  `recapSeen[kind]` is skipped.
- **Only with brews:** a due period with none of the person's brews in the
  current workspace is skipped. One `GET …/stats?mine=1` covering the due
  periods tells, and only when one is due; the answer is kept until the app
  reloads.
- **What it says:** "Your weekly recap is ready.", "Your monthly and
  yearly recaps are ready.", "Your 2026 in coffee is ready." or "Your
  weekly recap and 2026 in coffee are ready.", with a link to each
  (`/insights/recap?kind=…&start=…`; Your Year in Coffee's
  `/insights/year?year=…`).
- **Gone when:** opened (Insights → Recap showing the period just ended
  sets `recapSeen` for that kind, whichever way it was reached; the slides
  of the year just out set `recapSeen.yearInCoffee`), dismissed
  (× sets it for every period shown), or past `recapBannerDays`. Seen is
  per person, across workspaces.

## AI summary

Shown in Insights → Recap under the figures, when the workspace has AI,
for a period that has ended. The summary is
the caller's own, per workspace, period and scope (`mine`, or `all` with
"Only my brews" off), stored on a `recaps` row (schema.md). Rows are kept for good (gone only
with the person or the workspace), and a written (`done`) one is in the
workspace backup (backup.md §2b) with whose it is; a restore keeps only the
restorer's own, as everything restored becomes theirs. The figures aren't
stored: they're worked out from the brews each time.

- Always: a **Write summary** button; **Rewrite** once written.
- `recapAutoSummaries[kind]` on: the notification's tick (notifications.md §1b,
  "Recaps") writes the summary for the person's own brews before sending
  (or on its own, with that kind's push off),
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
  `recap_in_progress` (the period
  hasn't ended in the caller's time zone, else the workspace's, else UTC)
  or `ai_not_configured`; `503` when the queue can't be reached.
