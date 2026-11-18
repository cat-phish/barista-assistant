# 1. Authentication (JWT in httpOnly Cookie)

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

The session is a signed JWT (`HS256`, secret from `process.env.JWT_SECRET`)
with payload `{ "sub": "<userId>", "sv": <sessionVersion> }` and a 7-day
expiry. It is stored in a
cookie named `session` with `HttpOnly`, `SameSite=Lax`, `Path=/`, and
`Secure` when `NODE_ENV=production`. The frontend must send requests with
`credentials: "include"`. CORS allows only `process.env.CORS_ORIGIN` with
credentials enabled.

Passwords are hashed with `scrypt` (Node `crypto`, random 16-byte salt) and
compared in constant time. Stored as `scrypt$<N>$<salt>$<hash>` (N = 32768, kept in
the string so the cost can be raised later; older `scrypt$<salt>$<hash>` values
still verify at N = 16384). A short list of the most common passwords (e.g.
`password1`) is refused with 400 on register and change-password.

**Session invalidation:** every authenticated request compares the token's
`sv` with `users.session_version`. Changing the password increments it, so all
older sessions get `401` on their next request (the device that changed it is
issued a new cookie). A token for a deleted account also gets `401`. In both
cases the response clears the cookie.

**`401` vs `403`:** `401` always means "not logged in" (the frontend should send
the user to the login screen). A wrong *current* password in the endpoints
below is `403`, so a typo doesn't look like a logout.

## `POST /api/auth/register`

- **Auth Required:** `false`
- **Body:** `{ "email": "a@b.com", "password": "min 8 chars" }`
- **Success (`201 Created`):** sets the `session` cookie and returns
  `{ "user": { "id": "uuid", "email": "a@b.com", "name": null, "preferences": { ... }, "emailVerified": false, "isAdmin": false } }`
  (`isAdmin`: a server admin, granted on the server; §10; `emailVerified`: §1e)
- **Success with email verification on (`202 Accepted`, §1e):** `{ "pending": true }`,
  no cookie, and the same reply whether the address is new or taken (SEC-32).
  A new address gets the confirmation link; a taken one gets a mail saying
  someone tried to sign up. The person then logs in.
- **Errors:** `400` invalid body; `403` registration is closed
  (`ALLOW_REGISTRATION=false`); `409` email already registered (only with
  verification off, i.e. a server with no mail); `429` too many sign-ups.
- **Rate limit:** 5 sign-ups per IP per hour (`REGISTER_LIMIT_PER_HOUR`), counted
  whether or not they succeed; `429` carries `Retry-After`.

## `GET /api/auth/registration`

- **Auth Required:** `false`
- **Success (`200 OK`):** `{ "open": true, "inviteOnly": false, "emailVerification": false }`: whether this
  server takes new accounts. `ALLOW_REGISTRATION=false` closes it;
  `ALLOW_REGISTRATION=invite` takes only an email with a pending workspace
  invite (`403` otherwise on `POST /register`); anything else is open.
  Existing accounts still log in. The app hides "Create an account" when
  it's closed and says so when it's invite-only. `emailVerification` says
  whether §1e is on.

## `POST /api/auth/login`

- **Auth Required:** `false`
- **Body:** `{ "email": "a@b.com", "password": "..." }`
- **Success (`200 OK`):** sets the `session` cookie and returns
  `{ "user": { "id": "uuid", "email": "a@b.com", "preferences": { ... }, "isAdmin": false } }`
- **Errors:** `400` invalid body; `401` wrong email or password. The message is
  the same for both so it doesn't reveal which emails are registered.
- **Rate limit:** 10 failed attempts per account (the email, or the signed-in
  user on password/delete/backup checks) per 15 minutes, and 60 per IP; successful
  logins don't count. Further attempts get `429 Too Many Requests` with a
  `Retry-After` header (seconds) and `{ "error": "Too many login attempts. Try again later." }`.
  Counters are in-memory, so they reset when the backend restarts.
  **Behind a tunnel or CDN** in front of Caddy, set `trusted_proxies <ranges>` in
  the Caddyfile and leave `TRUST_PROXY=1`; otherwise every visitor shares one IP
  and the per-IP limits here and on sign-up (5/hour) count everyone together.
  Never raise `TRUST_PROXY` without that.

## `POST /api/auth/logout`

- **Auth Required:** `false`
- **Success (`204 No Content`):** clears the `session` cookie and revokes that
  token (its id is kept in Redis until it would expire), so a copy of the cookie
  stops working; other devices stay signed in. If Redis is down the cookie is
  still cleared but the token is not revoked.

Every API response carries `X-Content-Type-Options: nosniff`.

## `GET /api/auth/me`

- **Auth Required:** `true`
- **Success (`200 OK`):** `{ "user": { "id": "uuid", "email": "a@b.com", "name": "Jo", "preferences": { ... }, "isAdmin": false } }`

## Name

A person's `name` (`users.name`, up to 100 characters) is what others in
their workspaces see: who brewed a brew (`brewedBy`, §6), who logged a
serving (`loggedBy`, §6c), the members list (§2) and Your Year in Coffee's
bar's year (recaps.md §11c). `null` until set, and then the email shows
instead, except on Your Year in Coffee, which says "Member 1", "Member 2"…
and never shows emails. The email stays the login, and the journal CSV
(backup.md) keeps the email in "Brewed by". Set under Settings → Account.
Not in a backup, like the rest of the account.

### `PATCH /api/auth/me`

- **Auth Required:** `true`
- **Body:** `{ "name": "Jo" }` or `{ "name": null }`. Trimmed, inner runs of
  spaces made one; blank clears it. Other keys are refused.
- **Success (`200 OK`):** `{ "user": { ... } }`, as `GET /api/auth/me`.
- **Errors:** `400` invalid body or longer than 100 characters.

## Preferences

Every `user` in a response carries `preferences`: the person's display
units, with defaults filled in. Storage is always grams, °C and metres;
clients convert what they show and what's typed (roadmap: Units and defaults).

```json
{ "volumeUnit": "fl_oz", "showBothVolumes": false, "altitudeUnit": "m", "temperatureUnit": "c", "theme": "system", "rateReminders": true, "rateReminderMinutes": 15, "rateLaterDefault": false, "repeatKeeps": ["bean", "recipe", "size", "doseWater", "temp", "grinder", "grind", "waterProfile", "dilution", "window", "forWho"], "repeatButtonsBy": "made", "rememberSetup": ["what", "brewer", "recipe", "bean", "grinder", "grind"], "startDelays": {}, "nudgeButtons": ["dose", "water"], "steepReminders": true, "restReminders": true, "restReminderRepeatDays": null, "restingInBrewPickerDefault": true, "greenStockAlerts": true, "recaps": true, "recapPeriods": "both", "weekStartsOn": 1, "recapBanner": true, "recapBannerDays": 3, "recapNotify": true, "recapNotifyTime": "08:00", "timeZone": null, "recapAi": "manual", "recapSeen": {}, "yearSong": "off", "learnAboutMe": true }
```

- `volumeUnit`: `fl_oz` | `ml`: the brew page's yield estimate, and a new
  drink's default size unit.
- `showBothVolumes`: also show the other volume unit.
- `altitudeUnit`: `m` | `ft`.
- `temperatureUnit`: `c` | `f`.
- `theme`: `system` | `light` | `dark`. `system` follows the device's
  setting; the client also remembers the choice per device so it applies
  before the app loads.
- `rateReminders` (default `true`), `rateReminderMinutes` (5–240, default
  `15`) and `rateLaterDefault` (default `false`): rate-later reminders, see
  §1b.
- `startDelays`: an object of per-method delays (`filter`, `espresso`,
  `stovetop`, `other`), each `0` | `3` | `5`. Default `{}`. PATCH replaces
  the whole map; unknown keys are refused. Settings → Brew setup → Timer
  start shows one control per type. Custom methods use their underlying
  behaviour; a brew without a selected type uses `other`. A type missing
  from the map has no delay.
  Start counts down before a timed brew; Start now skips it. Long cold
  brews and logging without a timer do not use it. See
  `docs/timer_architecture.md` §3.
- `nudgeButtons` (default `["dose", "water"]`): the brew-log fields that
  show -/+ "nudge" buttons under them (Settings → Brew setup, "Nudge
  buttons"), a list of `NUDGE_KEYS`, each once: `dose`, `water`, `yield`,
  `brix`, `tds`, `time`, `temp`, `grind`. PATCH replaces the whole list;
  unknown or repeated keys are refused. A field hidden under Settings →
  Fields shows no buttons. Dose and water count an empty box as 0. On
  any other empty field the buttons are greyed where an expected value is
  known, and the first tap fills it in and applies the step (never below
  0); with none they stay off until the field has a value:
  - `yield`: the recipe's expected yield (espresso: target shot weight);
  - `tds`: EY × dose ÷ beverage weight (the water for immersion styles,
    else the yield or its expected value), with EY your average for the
    recipe (at least 2 of your brews with a TDS), else for its method,
    else 20 % (filter) / 19 % (espresso); `brix`: that TDS (or the one
    typed) on the Brix curve. Your brews come from `GET …/brew-logs`
    (`mine=1`), loaded on the brew page only; editing a journal entry uses
    the default EY;
  - `time`: the middle of the recipe's finish window, else your last brew
    of the recipe; `temp`: the recipe's target, else your last brew of it;
  - `grind`: none (the brew page fills the setting in).
- `steepReminders` (default `true`): remind when a cold brew's steep window
  opens (§1b).
- `restReminders` (default `true`): remind, the morning it's ready, when a
  bean you set resting (or a home roast you logged) is ready (§1b, "Resting
  beans").
- `restReminderRepeatDays` (integer 1–60 or `null`, default `null`): remind
  again every that many days until the bean is made active; `null` = once.
  It applies to all your resting beans.
- `restingInBrewPickerDefault` (default `true`): whether a bean you add
  resting is offered in the brew picker while it rests
  (`beans.md` §4 `restInBrewPicker`), unless the form says.
- `greenStockAlerts` (default `true`): tell when a roast you save takes a
  green coffee below its `lowStockGrams` (§1b).
- `repeatKeeps`: what repeating a brew copies (Settings → Brew setup, "Copy
  when repeating"), a
  list of `REPEAT_KEEPS`, each once:
  - `bean`: the brew's bean, or the newest active bag of the same coffee
    when that one's archived; off, setup keeps the bean it had (remembered,
    or empty to pick);
  - `recipe`: the brew's recipe on its brewer; off, the brewer's last
    recipe, as for a new brew (what you're making and the brewer still come
    from the brew);
  - `size`: the drink size;
  - `doseWater`: dose and water, and a flash chilled brew's ice;
  - `temp`;
  - `grinder`;
  - `grind`: the setting and RPM, on the same grinder;
  - `waterProfile`;
  - `vessel`: what the yield is weighed in (off by default: new brews are
    weighed directly);
  - `dilution`: the dilution served (cold styles, concentrates); a long brew's `steepTemp`
    goes with `temp`;
  - `window`: the window the brew aimed for (cold styles: a long brew's
    steep window, rapid cold's target finish, brew-logs.md §6);
  - `grinderWeights`;
  - `notes`: shown on the log form as a reminder, not copied;
  - `forWho`: who it was for (brew-logs.md §6, "Who it's for"), leaving out
    archived guests; off, a repeat is for you alone.

  Default: the first ten and `forWho`. A `PATCH` sends the whole list. What you're
  making, the brewer and the prep checklist (the tools that brew used,
  rather than the recipe's default prep) always come along; results and
  ratings never do. A note on what couldn't be filled (an archived bean,
  recipe, grinder, water or vessel) is shown only when its option is on.
  `prepTools` was an option until migration 0073, which took it out of
  saved lists. `bean` and `recipe` were always copied until migration 0100
  made them options and added them to every saved list.

  **Parity rule:** the options follow the brew form. Every brew parameter
  (each `brew.*` field in the field registry, `frontend/src/lib/fields.ts`)
  is listed in `REPEAT_FOR_FIELD` (`frontend/src/lib/repeatBrew.ts`):
  - either with the `repeatKeeps` option that copies it;
  - or as `'always'`, always copied (the prep checklist);
  - or as `'result'`, measured each time and never copied (yield, TDS,
    first drop).

  A new brew parameter gets one of these when it's added. A new option
  goes into `REPEAT_KEEPS` (shared schema and validation), `REPEAT_OPTIONS`
  and `applyRepeat`, and into the default only if repeating should copy it
  out of the box. The TypeScript type and `repeatBrew.test.ts` fail until
  it's done.
- Recaps (Settings → Recaps, recaps.md §11c):
  - `recaps` (default `true`): tell me when a recap is ready. Off, there's
    no banner, notification or automatic summary; Insights → Recap still
    shows one on a "Show recap" button.
  - `recapPeriods`: `weekly` | `monthly` | `both` (default).
  - `weekStartsOn`: 0–6, 0 = Sunday (default `1`, Monday). Weeks in recaps
    and Insights' weekly charts.
  - `recapBanner` (default `true`) and `recapBannerDays` (1–14, default
    `3`): the brew-page banner, and how many days after the period it shows.
  - `recapNotify` (default `true`) and `recapNotifyTime` (`HH:MM` on a
    quarter hour, default `"08:00"`): the notification, on the first day of
    the new period at that local time (§1b).
  - `timeZone`: an IANA name (e.g. `Europe/London`), or `null` (default) for
    each workspace's `timeZone` (§2), else the server's `BREW_TIMEZONE`. The
    client sends the browser's with each Settings → Recaps change. An
    unknown name is `400`.
  - `recapAi`: `off` | `manual` (default) | `auto`: the AI summary.
  - `recapSeen`: `{ "weekly"?: "YYYY-MM-DD", "monthly"?: "YYYY-MM-DD", "yearly"?: "YYYY-MM-DD" }`,
    the start of the last period whose banner was opened or dismissed.
    Default `{}`. A `PATCH` sends the whole object.
  - `yearSong`: `off` (default) | `builtin` | `own`: music on Your Year in
    Coffee (`recaps.md` §11c, "Motion and sound"). `own` plays your
    uploaded song ("Year song" below) and falls back to `off` without one.
- `learnAboutMe` (default `true`): Learn about me (§1d). Off, nothing is
  learned, likes and dislikes are refused (`409`) and hidden, and neither
  their learned list nor their votes go to the AI; the list is kept.
- `repeatButtonsBy` (default `"made"`): what the brew page's quick repeat
  buttons (Settings → Brew setup, "Repeat buttons") count as different
  brews, one button each for the last 3, over every brew
  (`brew-logs.md`, `GET …/brew-logs/repeats`):
  - `made`: the drink, or a plain brew's brewer method;
  - `brewer`: also the brewer;
  - `recipe`: also the recipe;
  - `coffee`: also the coffee (roaster + name, so batches count as one).
- `rememberSetup`: what the brew page starts a new brew with from the last
  brew (Settings → Brew setup, "Remember from last time"), a list of
  `REMEMBER_KEYS`, each once:
  - `what`: what you're making, and the drink;
  - `brewer`: the brewer, for each method;
  - `recipe`: the recipe, for each brewer;
  - `bean`;
  - `grinder`;
  - `grind`: your last setting and RPM with that grinder and recipe;
  - `waterProfile`;
  - `vessel`: what the yield is weighed in, or weighed directly (off by
    default);
  - `prepTools`: the prep checklist, for each brewer;
  - `size`: the drink size, for each drink.

  Default: the first six. A `PATCH` sends the whole list. Only the choice
  is stored here: the values themselves stay on each device (browser
  storage, per workspace), and archived ones are skipped. A drink's default
  brewer and recipe, and a repeat, come before what's remembered.

### `PATCH /api/auth/me/preferences`

- **Auth Required:** `true`
- **Body:** any non-empty subset of the keys above; unknown keys are `400`.
  Merged into what's stored.
- **Success (`200 OK`):** `{ "preferences": { ...all of them } }`
- **Errors:** `400` invalid, empty or unknown keys.

## 1c. Your AI prompt

Each person can tune the AI's prompt (docs/api/llm-contract.md §9) to
their own taste. It belongs to the person, not the workspace: it's the
same in every workspace they're in, and there's no workspace or owner
setting above it, so several people in one home can each keep their own.
Stored as `users.ai_prompt` (`AiPrompt` in `@barista/shared/aiPrompt`),
not in preferences, so it isn't sent with every `user`.

- **Instructions** (up to 2000 characters): added to the analysis and
  suggest prompts as the `instructions` section, just before `end`, after
  `INSTRUCTIONS_INTRO`.
- **Label instructions** (`labelInstructions`, up to 2000 characters):
  added to the label-reading prompt instead (llm-contract.md §9c), after
  `LABEL_INSTRUCTIONS_INTRO`; brewing instructions aren't sent there. A
  prompt saved before it has none (`null` in responses).
- **Overrides** (section key → text, 1–4000 characters each): your own text
  in place of a section's default. Locked sections (`output`,
  `suggestOutput`, `end`) say what the answer must hold and can't be
  changed. Whether a section is sent at all stays the worker's to decide
  (the espresso section only with espresso, and so on).

**Whose prompt is used:**
- an analysis (§8) uses the **brew's barista's** prompt (`brew_logs.userId`),
  whoever asks and also for auto-analyze; a brew with no barista (an account
  deleted) uses the defaults;
- Suggest parameters (§8b) uses the **asker's** (`requestedBy` on the row).
- Reading a bean label (§4d) uses the **asker's** (`requestedBy` in the job).
  Its sections (`labelCore`, "Reading a bean label", and `labelWeb`,
  "Looking a bean up on the web") and label instructions don't make
  analyses or suggestions count as customized.

**A one-off note** (up to 500 characters) can go with one request: the
`note` body field on `POST …/analyze`, `POST …/parameter-suggestions` and
their previews (§8, §8b, §8d). It's sent as the `note` section after the
instructions (`NOTE_INTRO`). A suggestion keeps it on its row (`note`); an
analysis doesn't save it apart from the request saved with it (§8c).
Anyone who can ask (owner, barista) can add one.

A result made with instructions, overrides or a note is saved with
`promptVersion` `PROMPT_VERSION + "+custom"`, so it can be told apart from
the default prompt's results.

### `GET /api/auth/me/ai-prompt`

- **Auth Required:** `true`
- **Success (`200 OK`):**
  ```json
  {
    "aiPrompt": { "instructions": "I prefer bright cups.", "labelInstructions": null, "overrides": { "core": "..." } },
    "sections": [{ "key": "core", "label": "What to do (analysis)", "prompts": ["analysis"], "locked": false, "text": "..." }],
    "instructionsIntro": "...", "labelInstructionsIntro": "...", "noteIntro": "...",
    "limits": { "instructions": 2000, "section": 4000, "note": 500 }
  }
  ```
  `aiPrompt` is `{ "instructions": null, "overrides": {} }` when nothing is
  changed. `sections` are every section's default, in the order sent, to
  show and reset to.

### `PUT /api/auth/me/ai-prompt`

- **Auth Required:** `true`
- **Body:** `{ "instructions": "..." | null, "labelInstructions"?: "..." | null, "overrides": { "<key>": "text" } }`,
  replacing what's stored. Text is trimmed; empty instructions become
  `null`, and an override equal to its default is dropped. Nothing left
  changed is stored as `null`.
- **Success (`200 OK`):** the same as `GET`.
- **Errors:** `400` too long, an empty override, a key that isn't a
  section ("not a prompt section") or a locked one ("can't be changed"),
  an unknown body key.

**Settings → Your AI prompt** (`SettingsPromptView.vue`, under "You"): an
instructions box, and an **Advanced** switch that lists every section with
its own text box, an "Edited" mark and "Reset to default" (locked ones
shown read-only). The switch is on while there are overrides, otherwise
remembered per viewer in the browser. "Add a note for the AI"
(`AiNoteField.vue`) sits by Suggest parameters and Get AI suggestion.

## 1e. Email verification

Optional, **off by default** (`EMAIL_VERIFICATION=true` turns it on; it needs
`SMTP_HOST`, `MAIL_FROM` and `APP_URL`, and the server refuses to start with
it on and any of them missing). Servers with no mail account leave it off and
nothing below applies: `users.emailVerifiedAt` stays null, no mail is sent,
and the endpoints answer `404`.

With it on:

- Registering mails a link to the address; `user.emailVerified` (in every
  `user` object) is `false` until it's opened. `GET /registration` also
  returns `emailVerification: true`, so the app can say so.
- The one thing an unconfirmed address can't do is **accept a workspace
  invite** (`403`): invites go to an email, and without this anyone could
  register an address first and claim it. Everything else works as before.
- The link is `APP_URL/verify-email#<token>`, built from `APP_URL`, never
  from the request's Host. The token is 256 random bits in the fragment (so it
  isn't in server logs or a Referer); only its SHA-256 is stored
  (`email_tokens`, with the address it was sent to), it works once and lasts 24
  hours, and a new mail cancels the older link. Existing accounts start
  unconfirmed and can ask for a link.

### `POST /api/auth/verify-email/send`
- **Auth Required:** `true`. Mails a new link (`204`, also when already
  confirmed). `404` when verification is off; `429` after 5 an hour.

### `POST /api/auth/verify-email`
- **Body:** `{ "token": "..." }`. `204` confirms the address the mail went to,
  if the account still has it. `400 "This link is no longer valid"` for an
  unknown, used, replaced or expired token (all the same). `404` when off.
  `429` after 30 tries in 15 minutes per IP.

## 1d. Learned preferences

What the AI has learned each person likes and turns down
(docs/api/llm-contract.md §9g, docs/backlog.md item 20), like "prefers
19-20% EY" or "turns down cooler-water ideas", each with how many brews or
votes back it. It belongs to the person, like Your AI prompt (§1c): the same
in every workspace, stored as `users.ai_preferences` (`AiPreferences` in
`@barista/shared/aiPreferences`), so it isn't in workspace backups. A
workspace's own list (`WorkspaceSettings.aiPreferences`, up to 20 lines of
up to 200 characters, set by owners in Settings → AI) is in its backups; the
person's list wins where they conflict.

- **items** (up to 20): `{ id, text, basis, source, updatedAt }`; `text` up to
  200 characters, `basis` the brews or votes behind it (0 for one the person
  wrote), `source` `"ai"` or `"person"`.
- **proposals** (up to 10): changes the AI suggested and the person hasn't
  accepted or dismissed: `{ id, change: "add" | "edit" | "remove", targetId,
  text, basis, why, createdAt }` (`targetId` the item an edit or removal is
  for, `text` null for a removal). Accepting applies it; only items go to the
  AI.
- **learn** (`"auto"` default, or `"manual"`): auto updates the list after
  every like or dislike (§8b "Feedback") and every analysis of their brews
  (§8); manual only when they press **Update now**.
- **apply** (`"propose"` default, or `"apply"`): whether the AI's changes wait
  as proposals or apply right away. Even with apply, a change to an item the
  person wrote stays a proposal.
- **through** (workspace id → ISO time): when each workspace's signals were
  last learned from.
- **usage** (`{ runs, promptTokens, completionTokens }`): the learning
  calls made so far, for the average Settings shows.

**Learn about me** (`learnAboutMe`, §1 preferences) switches all of it for
the person: off, nothing is learned, the Feedback links are hidden and
votes refused, and only the workspace's lines go to the AI. **A dislike
counts as accepting:** a change the AI learns from a 👎 applies at once even
with `propose` (still a proposal for a line the person wrote), so a
disliked idea stops coming back.

Settings → **Learned preferences** (`SettingsLearnedView.vue`, under
"You") has the switch, with what it costs (an update sends about
800–1,500 tokens and gets about 100 back, measured on real brews; the list
adds about 200–400 to each analysis and suggestion; and the person's own
average from `usage`) and that it's stored on the server, sent only to a
hosted AI; then Learn and Changes, Update now, the proposals with
Accept/Dismiss and the list to edit.

### `GET /api/auth/me/ai-preferences`

- **Auth Required:** `true`
- **Success (`200 OK`):** `{ "aiPreferences": AiPreferences, "limits": { "items": 20, "text": 200 } }`,
  with an empty list and the defaults when nothing is stored.

### `PUT /api/auth/me/ai-preferences`

- **Auth Required:** `true`
- **Body:** `{ "learn": "auto" | "manual", "apply": "propose" | "apply", "items": [{ "id"?: "...", "text": "..." }] }`,
  replacing the items in that order. An item with an existing id and the
  same text keeps its basis and source; a changed or new one becomes
  `source: "person"`. Proposals for removed items are dropped.
- **Success (`200 OK`):** the same as `GET`.
- **Errors:** `400` too many, too long or empty text, an unknown id, an
  unknown body key.

### `POST /api/auth/me/ai-preferences/proposals/:proposalId/accept` and `…/dismiss`

- **Auth Required:** `true`
- Accept applies the change (an edit or removal whose item is gone just
  goes); dismiss drops it. Either way the proposal is removed.
- **Success (`200 OK`):** the same as `GET`. **Errors:** `404` no such
  proposal; `409` accepting an add with 20 items already.

### `POST /api/workspaces/:workspaceId/ai-preferences/update`

- **Auth Required:** `true`, an owner or barista of the workspace.
- Queues the learning job (§9g) for the signed-in person in this workspace
  now, whatever `learn` is. **Success (`202 Accepted`):** `{ "queued": true }`.
- **Errors:** `403` a viewer; `409` Learn about me is off, the workspace keeps learned preferences
  from the AI (`learnedPreferences` in `aiHidden`), or no AI is set up
  (`ai_not_configured`); `503` the queue is down.

## `POST /api/auth/password`

Changes the caller's password and logs out all their **other** sessions.

- **Auth Required:** `true`
- **Body:** `{ "currentPassword": "...", "newPassword": "min 8 chars" }`
- **Success (`204 No Content`):** sets a fresh `session` cookie for this device.
- **Errors:** `400` invalid body, or `newPassword` equals `currentPassword`;
  `403` `currentPassword` is wrong; `429` too many wrong attempts (same limit
  and response as login).

## `DELETE /api/auth/me`

Deletes the caller's account. Their workspace memberships are removed. Their
brew logs are **kept** as shared workspace history with `userId: null` and
`brewer: null` (§6).

- **Auth Required:** `true`
- **Body:** `{ "password": "..." }` (re-entered, so an unattended logged-in
  device can't delete the account)
- **Success (`204 No Content`):** clears the `session` cookie.
- **Errors:** `400` invalid body; `403` wrong password; `429` too many wrong
  attempts; `409` the caller is the only owner of one or more workspaces, with
  body `{ "error": "...", "workspaces": [ { "id", "name", "slug" } ] }`.
  Nothing is deleted. They must promote another owner (§2 Members) or delete
  those workspaces first.
