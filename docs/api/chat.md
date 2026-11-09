# 12. AI Chat

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The **Chat** tab in Insights: a conversation with the AI, its replies appearing
as they're written. It changes nothing in the journal itself: a reply can
carry **proposals**, which only fill in a form for the person to save. The worker
makes the AI call (§9e), since only it can read the keys.

A chat belongs to the person who started it, in that workspace. **Nobody else
can see one**, owners included: someone else's chat answers `404`. Chats aren't
in workspace backups (§2b), which would hand them to whoever downloads the file.

## Chats

All under `/api/workspaces/:workspaceId/chats`. `Auth Required: true`. Reading
your own chats is open to any member; starting one or sending a message needs
`owner` or `barista`, as an analysis does.

**A chat:** `{ id, title, createdAt, updatedAt }`. `title` is the start of the
first message; `updatedAt` moves with each message.

**A message:** `{ id, position, role, content, attachments, proposals, photos,
status, error, model, createdAt }`. `proposals` is `[]` but on a reply that
made some (below).
- `role`: `user` or `assistant`.
- `status`: `done`; `pending` while the reply is being written; `failed` with
  `error` saying why. A failed reply keeps whatever it had written in `content`
  and isn't sent to the AI on later turns. A reply still pending after 10
  minutes (the worker died) is marked failed the next time the chat is read.

| Route | |
| --- | --- |
| `GET /` | `{ chats }`, yours, latest first. |
| `POST /` | Body `{ content, attachments?, photoIds? }`; `content` is 1–4000 characters. Starts a chat with that message. `202` with `{ chat, messages }`: the message and its pending reply. |
| `GET /:chatId` | `{ chat, messages }`, oldest first. |
| `DELETE /:chatId` | `204`. |
| `POST /:chatId/messages` | Body as for `POST /`. `202` with `{ chat, messages }`: only the two new ones. `409` while a reply is still being written. |
| `GET /:chatId/messages/:messageId/stream` | The reply as server-sent events, below. |
| `PUT /:chatId/messages/:messageId/proposals/:index` | Body `{ state: "open" \| "dismissed" }`. Any member, on their own chat. `200` with `{ proposals }`, the message's, updated. `404` for an index it doesn't have. |
| `POST /photos` | The image as the body, any type, up to 15 MB. `201` with `{ photo: { id, width, height } }`. `400` if it can't be read. |
| `GET /photos/:photoId` | The image, as WebP. Only the person who uploaded it. |

**Attachments:** `attachments` is up to the workspace's `chatMaxAttachments`
(§2 of `workspaces.md`: 1–100, default 50) `{ "kind": "brew" | "bean" |
"recipe", "id": "uuid" }`, each from this workspace, or the request is a `400`.
Charts and periods (below) carry more.
Each reply is sent the latest `chatMaxAttachments` items attached across the
chat's last 40 messages, each once.
A message comes back with `attachments: [{ kind, id, label }]`, where `label`
is what the item was called when attached, and `[]` when there are none. Only
the reference is kept: each reply reads the item afresh (§9e), so a change or a
delete applies to the rest of the chat. Attachments go in full: what Settings →
AI hides is kept from analyses and suggestions, not from chat.

**Charts:** an Insights chart is `{ "kind": "chart", "id": "uuid", "chart":
snapshot }`, its numbers as the browser worked them out, since the server
can't rebuild them. The snapshot is `{ tab, title, note, filters, head, rows,
cut }`: `filters` says in words what the numbers cover ("Last 30 days · Only
mine"), `head` is up to 20 column names, `rows` up to 200 rows of strings (200
characters at most) and numbers, and `cut` how many rows were left out past
200. It's kept on the message as sent, comes back as `chart` on the
attachment, with the title as its `label`, counts toward the chat's size and
goes in the export. A chart's `id` is the browser's: the same chart under the
same filters is the same attachment. The Overview's tiles go as one chart,
"Overview totals". Settings → AI doesn't apply to it.

**Periods:** a live period is `{ "kind": "period", "id": "uuid", "period":
spec }`: the Brews filters saved as one item rather than the brews they match
(`@barista/shared/chatPeriod`). The spec is `{ range, from, to, beanId,
recipeId, brewerId, mine }`:
- `range`: `7d`, `30d`, `90d` or `1y` roll with the chat, counted back from
  the day of each reply in the workspace's time zone, so `from` and `to` are
  `null`. (The picker's list counts back from the browser's day, so near
  midnight it can be a day off what the reply sees; the reply's is the one
  that counts.) `all` is every brew, also with no dates. `week`, `month` and
  `custom` are fixed days, so `from` and `to` (`YYYY-MM-DD`, `from` first)
  are both set. The picker fixes "This week", "Last week" (on your
  `weekStartsOn`), "This month" and "Last month" to their dates when
  attached.
- `beanId`, `recipeId`, `brewerId`: each `null`, or one in this workspace
  (else `400`). `mine`: only the brews of the person whose chat it is.

The worker runs it again for every reply (`llm-contract.md` §9e), so brews
logged, changed or deleted since are seen. It sends figures for every brew in
the period, the same figures over the period before (the calendar week or
month before, else as many days before; none for `all`), and the newest brews
in detail, up to the workspace's `chatPeriodMaxBrews` (`workspaces.md` §2:
10–300, default 60) or your own lower `periodMaxBrews` (below), with how many
were left out. A period counts as **one** toward `chatMaxAttachments`. Its
`label` is made by the server ("Brews, last 30 days · Guji · Only mine",
"Brews, 26 Oct – 1 Nov", "Brews, October 2026"). It goes in the export as it
is. In another workspace, a filter that isn't there makes it unavailable to
the AI. A period has no ref a proposal can use, since it isn't one item.
Settings → AI's hidden details don't apply to it.

**Photos:** upload each one first, then send up to 4 as `photoIds`; a photo
that's yours, not yet sent and in this workspace, or the request is a `400`. A
message comes back with `photos: [{ id, width, height }]`. Photos are resized as
bean photos are (`bean-photos.md` §4c, EXIF dropped) and kept with the chat,
under `PHOTO_DIR/chats/<workspaceId>/`, and go when it does. One uploaded but
never sent is removed the next time the server starts, a day later or more. The
Chat tab uploads a photo as soon as it's picked, pasted into the message box or
dropped on the conversation (images only; pasted text stays text).

## Proposals

A reply can end with up to 3 proposals (`CHAT_PROPOSALS_MAX`), each shown as a
card under it with **Open** and **Dismiss**. Opening one fills in a form; the
journal changes only when the person saves there, through its usual route.
Every proposal has `kind`, `title`, `why` and `state` (`open` or `dismissed`).
Ids name what was attached when it was proposed, and may be gone since; each
label is what it was called then.

| `kind` | Also | Open fills in |
| --- | --- | --- |
| `brew` | `beanId`, `recipeId`, `grinderId` (each with its label, or `null`), `grindSetting` (on that grinder; `null` without one), `tempC`, `ratio` ((water + ice) / dose, or shot weight / dose) | the brew page, as Suggest parameters does (`analysis.md` §8b) |
| `recipeChange` | `recipeId`, `recipeLabel`, `changes`: only the recipe fields that change | that recipe's form |
| `newRecipe` | `brewerId`, `brewerLabel` (`null`: the person picks), `recipe`: at least `name` and `targetDoseGrams` | a new recipe form |

Recipe fields are `name`, `targetDoseGrams`, `targetWaterGrams`,
`targetIceGrams`, `expectedYieldGrams`, `targetTempC`, `expectedFinishMinSec`,
`expectedFinishMaxSec` and `steps` (the whole list, each `{ stepType, label,
durationSec, targetWaterGrams, targetTempC, pressureBar, flowRate }`), as in
`recipes.md` §5; the form checks them on saving. How the worker reads them is
`llm-contract.md` §9e. They count toward the chat's size and go in the export.

**Warnings:** a `recipeChange` or `newRecipe` can carry `warnings`, plain
sentences on steps that don't hold up (`@barista/shared/recipeChecks`): water
targets going back down, the last pour more than 2 g off the recipe's water,
a pour faster than 12 g/s or slower than 1 g/s, or the steps ending after the
finish window or more than 60 s before it. The card lists them under "Check
the steps before saving"; the proposal is kept and opens as usual. A change
is checked as the recipe after it, and only when it touches the steps, the
water or the window. Absent when there are none, and on proposals from before.

`POST`s answer `409` with `code: "ai_not_configured"` when the workspace has no
AI (§2d), and `503` when the queue can't be reached (nothing is saved).

## The Chat tab

Insights → Chat (`frontend/src/views/stats/StatsChatView.vue`) fills the
screen below the tabs: the thread scrolls and the composer stays at the
bottom. On a phone the chat list is a drawer behind **Chats**.

- **Attaching** opens a picker (`ChatAttachDialog.vue`) with Brews, Beans,
  Recipes and Charts tabs, a checkbox on each row. Brews narrow through the brew-log
  list's filters (`brew-logs.md`: a period, bean, recipe, brewer, only mine),
  and **Select all** ticks every brew that matches, newest first, up to
  `chatMaxAttachments`. Beans and recipes are searched in the browser. The
  picker edits the whole selection, so unticking removes an item. On the
  Brews and Charts tabs the filters fold into one line (what they're set to,
  in words) with a **Filters** button, so the list gets the room. Its
  Period list adds Last 7 days, This and Last week, This and Last month to
  the brew list's. **Attach as live period** adds the filters as one
  period (above), once for the same filters, listed under the button with
  a ×.
- **Token warning** (`lib/chatTokens.ts`): once what a reply would be sent
  (this message's attachments and the chat's earlier ones) comes to about
  20,000 tokens, the picker's footer and the composer say "≈ 40k tokens,
  sent again with every reply". It's a rough count from per-kind averages
  measured on a real journal: about 610 tokens for a brew, 100 for a bean,
  320 for a recipe, 10 for each chart row, and 450 for a period plus 190 for
  each brew it sends in detail. A period's brews are counted as the picker's
  list matched them, which includes cold brews still steeping that the
  period leaves out, so it can run a little high.
- **Charts** (`ChartPicker.vue`) lists every chart on the Insights tabs the
  workspace shows, the Explore charts the person added included, and
  "Overview totals", under the Insights filter bar. Those filters start as the
  Insights page has them but are the picker's own: changing them leaves the
  page alone, and charts with their own period follow the picker's. The tab
  views are drawn out of sight with `CHART_HARVEST` provided, so each
  `ChartCard` hands over its title, note and table instead of drawing.
- **Attachments show as chips** by kind; more than three of a kind fold into
  one ("14 brews ▾") that opens the list.
- **Photos** are picked, pasted into the message box or dropped on the
  conversation.
- **Formatted replies** (`lib/markdown.ts`, `ChatMarkdown.vue`): paragraphs,
  headings, lists (one level of nesting), quotes, fenced code, pipe tables
  and rules; bold, italics, inline code and `http(s)` links. Drawn as
  elements, never as HTML: anything else the model writes, HTML included,
  is shown as text, and a link that isn't `http(s)` is only its text. Your own
  messages stay as typed.
- A failed reply has **Retry**, which puts the message and its attachments
  back in the box.
- **Proposal cards** (`ChatProposalCard.vue`, `lib/chatProposal.ts`) under a
  reply: the kind, title, why and the values it would set. **Open** (owners
  and baristas) hands it over through a store (`stores/chatProposal.ts`) and
  goes to `/brew?proposal`, `/recipes/:id/edit?proposal` or
  `/recipes/new?proposal`, which take it once:
  - The brew page switches to its bean and recipe (as an "Or try" does),
    then fills the temperature, the ratio (around what the batch holds) and
    the grind on its grinder, saying "Filled from AI chat" and naming what's
    gone or archived since.
  - The recipe form fills only what a change changes, over the recipe as
    saved, or a new recipe's values on its brewer (or none, to choose).
  - A reload drops it, and the page starts as usual.
  **Dismiss** folds a card to one line with **Undo**, saved on the chat.

## The reply stream

`text/event-stream`, on a same-origin `EventSource`, so the session cookie is
what authorizes it.

- `event: text`, data `{ "text": "…" }`: the next piece, to append. Each has an
  `id:`, so a browser that reconnects carries on from where it was
  (`Last-Event-ID`).
- `event: done`, data: the finished message (above), `done` or `failed`. Its
  `content` is the reply without its proposal blocks, which never reach the
  stream, and its `proposals` are the cards to show. The
  stream then ends. For a message that has already finished, this is all that's
  sent.
- A comment line every 10 seconds keeps idle connections open.

Closing the stream doesn't stop the reply: the worker finishes and saves it.

**How it travels:** the worker adds to a Redis stream, `chat-reply:<messageId>`
(`chatReplyKey`, `@barista/shared/jobs`), and the backend reads from it. An
entry is one field, `event`, holding `{ "type": "text", "text": "…" }` or
`{ "type": "end" }`. The message row is saved before `end`, so the `done` event
is read from the database. The Redis stream expires 5 minutes after the reply.

## Turning chat off

- **A workspace:** `aiChat` in its settings (§2, default `true`), under
  Settings → **AI**, owners.
- **One member:** `PUT /api/workspaces/:workspaceId/members/:userId/chat`, body
  `{ "enabled": boolean }`, owners. `200` with `{ userId, chatEnabled }`. The
  members list carries `chatEnabled`.

Off, starting a chat, sending a message and uploading a photo are a `403` with
`code: "chat_off"`. Chats already made stay readable, and `GET /` says whether
the caller can send: `{ chats, canSend }`.

## Keeping and purging

A person's chats are limited across all their workspaces, by what they take on
disk (messages, attachment references and photos together) and by age. **Both
limits apply:** the server's, and the person's own, which can be stricter but
not looser. `null` means no limit. Chats over a limit are deleted, oldest first
by `updatedAt`, within seconds of a change to a limit, after each message, and
hourly. The chat in use is never deleted for size.

| Limit | Server default | Range |
| --- | --- | --- |
| `maxBytes` | 1 GB (1073741824) | 1 KB to 1 PB |
| `maxDays` | none | 1 to 36500 |
| `dailyMessages` (server only) | 200 | 1 to 100000 |

`dailyMessages` is how many messages one person can send in 24 hours; over it,
a send is a `429` with `code: "chat_limit"`.

| Route | |
| --- | --- |
| `GET /api/auth/me/chat-settings` | `{ own, server, effective, usedBytes }`. `own` and `effective` are `{ maxBytes, maxDays }`, and `own` adds `periodMaxBrews`; `server` adds `dailyMessages`. |
| `PUT /api/auth/me/chat-settings` | Body `{ maxBytes, maxDays, periodMaxBrews? }`. `400` if either limit is over the server's. `periodMaxBrews` (10–300, or `null` for the workspace's) is your own cap on a period's brews; left out, it stays as it was. Answers as `GET`. |
| `DELETE /api/auth/me/chats` | Purges all your chats and photos, in every workspace. `204`. |
| `GET /api/server/chat` | Admins. `{ limits, usedBytes }`, `usedBytes` for the whole server. |
| `PUT /api/server/chat` | Admins. Body as `limits`. Answers as `GET`. Lowering a limit never rewrites a person's own: the lower one applies. |
| `DELETE /api/server/chats` | Admins. Purges everyone's chats and photos. `204`. |

Leaving a workspace, or being removed from it, deletes your chats there.

## Export and import

Your chats in a workspace as one `.zip`, to keep or to bring into another
workspace or server. Not a workspace backup: it holds only your own chats.

| Route | |
| --- | --- |
| `GET /export` | The zip: `chats.json` and `photos/<id>.webp`. Any member. A reply still being written is left out. |
| `POST /import` | The zip as the body, `application/zip`, up to 250 MB. `owner` or `barista`, with chat on. `200` with `{ imported, skipped }`. |

`chats.json` is `{ version: 1, exportedAt, chats }`; a chat is `{ id, title,
createdAt, updatedAt, messages }`, and a message as above without its `id`, with
`photos` as `{ id, width, height }` and `proposals` `null` when there are none
(a file from before proposals has no `proposals`, and imports as none).

Importing adds chats to your own, keeping their dates. A chat you already have
here, by `id`, is skipped. Photos are checked as a backup's are, and one that
can't be read is left out. A file that would take you past your size limit is a
`409`, and nothing is added. Chats older than your age limit are removed as
usual, right after the import. An attachment from another workspace stays as its
label, and the AI is told it's unavailable (§9e).
