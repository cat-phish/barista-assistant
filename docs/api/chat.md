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

**Attachments:** `attachments` is up to 10 `{ "kind": "brew" | "bean" |
"recipe", "id": "uuid" }`, each from this workspace, or the request is a `400`.
A message comes back with `attachments: [{ kind, id, label }]`, where `label`
is what the item was called when attached, and `[]` when there are none. Only
the reference is kept: each reply reads the item afresh (§9e), so a change, a
delete or a new Settings → AI choice applies to the rest of the chat.

**Photos:** upload each one first, then send up to 4 as `photoIds`; a photo
that's yours, not yet sent and in this workspace, or the request is a `400`. A
message comes back with `photos: [{ id, width, height }]`. Photos are resized as
bean photos are (`bean-photos.md` §4c, EXIF dropped) and kept with the chat,
under `PHOTO_DIR/chats/<workspaceId>/`, and go when it does. One uploaded but
never sent is removed the next time the server starts, a day later or more.

`POST`s answer `409` with `code: "ai_not_configured"` when the workspace has no
AI (§2d), and `503` when the queue can't be reached (nothing is saved).

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
