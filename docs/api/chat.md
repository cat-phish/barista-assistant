# 12. AI Chat

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The **Chat** tab in Insights: a conversation with the AI, its replies appearing
as they're written. Read-only: it changes nothing in the journal. The worker
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

**A message:** `{ id, position, role, content, attachments, photos, status,
error, model, createdAt }`.
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
| `POST /photos` | The image as the body, any type, up to 15 MB. `201` with `{ photo: { id, width, height } }`. `400` if it can't be read. |
| `GET /photos/:photoId` | The image, as WebP. Only the person who uploaded it. |

**Attachments:** `attachments` is up to the workspace's `chatMaxAttachments`
(§2 of `workspaces.md`: 1–100, default 50) `{ "kind": "brew" | "bean" |
"recipe", "id": "uuid" }`, each from this workspace, or the request is a `400`.
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

**Photos:** upload each one first, then send up to 4 as `photoIds`; a photo
that's yours, not yet sent and in this workspace, or the request is a `400`. A
message comes back with `photos: [{ id, width, height }]`. Photos are resized as
bean photos are (`bean-photos.md` §4c, EXIF dropped) and kept with the chat,
under `PHOTO_DIR/chats/<workspaceId>/`, and go when it does. One uploaded but
never sent is removed the next time the server starts, a day later or more. The
Chat tab uploads a photo as soon as it's picked, pasted into the message box or
dropped on the conversation (images only; pasted text stays text).

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
  picker edits the whole selection, so unticking removes an item.
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

## The reply stream

`text/event-stream`, on a same-origin `EventSource`, so the session cookie is
what authorizes it.

- `event: text`, data `{ "text": "…" }`: the next piece, to append. Each has an
  `id:`, so a browser that reconnects carries on from where it was
  (`Last-Event-ID`).
- `event: done`, data: the finished message (above), `done` or `failed`. The
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
| `GET /api/auth/me/chat-settings` | `{ own, server, effective, usedBytes }`. `own` and `effective` are `{ maxBytes, maxDays }`; `server` adds `dailyMessages`. |
| `PUT /api/auth/me/chat-settings` | Body `{ maxBytes, maxDays }`. `400` if either is over the server's. Answers as `GET`. |
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
`photos` as `{ id, width, height }`.

Importing adds chats to your own, keeping their dates. A chat you already have
here, by `id`, is skipped. Photos are checked as a backup's are, and one that
can't be read is left out. A file that would take you past your size limit is a
`409`, and nothing is added. Chats older than your age limit are removed as
usual, right after the import. An attachment from another workspace stays as its
label, and the AI is told it's unavailable (§9e).
