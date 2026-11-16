# 1f. Research settings, and your own research

Which of the research findings the AI's analyses and suggestions build on
(`RESEARCH_FINDINGS` in `@barista/shared/research`, llm-contract.md §9
"Research findings"; docs/backlog.md item 21) are sent, and findings people
add themselves. Helpers and types live in `@barista/shared/researchSettings`.

**Who has what.** Like the prompt (§1c) and learned preferences (§1d), the
split is person versus workspace:

- **A person's** (`users.research`, `UserResearch`): their choice per
  built-in finding with a note of their own, their own findings, and the
  research version they last dismissed the update notice for. The same in
  every workspace; **not in workspace backups** (like §1c). Their own
  findings are private: a saved request (analysis.md §8c) shows the §1c
  placeholder in their place (SEC-22), keyed `own.private` in its text and
  `research.own.private` in its `sections` (once, however many were sent), so
  other members can't tell which were used (SEC-04).
- **A workspace's** (`workspaces.research`, `ResearchSettings`), set by
  owners: a default per built-in finding, and shared findings everyone in
  the workspace gets and can read. In its backups (backup.md §2b, the
  `workspace` block's `research`).

**Precedence** (`effectiveMode`): the person's choice, then the workspace's
default, then the finding's own: `on` for a rule, `experiment` for a finding
marked `experiment` (`coldBloom`, `firstPours`). A choice of `null` is no
choice (a note alone).

A person can also switch a **workspace's own finding** for themselves
(SEC-02): `settings["own.<id>"] = { mode }` in their `PUT`, which beats the
mode the workspace gave it (`resolveResearch`). The id isn't checked against
a workspace when saved (it's 8 hex characters; the same choice holds in every
workspace with that finding), and one no workspace has is ignored. It only
applies to workspace findings: a person's own finding has its own `mode`, and
a workspace's `PUT` takes built-in keys only.

**Modes** (`RESEARCH_MODES`):

| Mode | Analyses and Suggest parameters | Chat-style experiment ideas |
| --- | --- | --- |
| `on` | sent as a rule when its scope and needs fit the brew | no |
| `off` | never | no |
| `experiment` | never | yes: `experimentFindings` (`worker/src/research.ts`) lists them for the chat's experiment proposals (branch `experiment-cards`; not wired in this section's change) |

**Whose settings a job uses:** the same person as the prompt (§1c): an
analysis the brew's barista's, a suggestion the asker's; plus the
workspace's. A result made with anything other than the defaults (a
built-in switched, or any own finding sent) is saved with `promptVersion`
`PROMPT_VERSION + "+custom"`, like a customized prompt. `promptFor` in
`worker/src/processor.ts` loads both (`loadResearch`), for the jobs and for
their "What the AI sees" preview (analysis.md §8d), which shows the same
research with the person's own findings redacted as in a saved request
(SEC-03).

**Own findings** (`OwnFinding`, at most 20 per person and 20 per workspace):

| Field | Holds |
| --- | --- |
| `id` | 8 hex characters, made by the server; `own.<id>` in the prompt |
| `title` | up to 80 characters, for Settings |
| `text` | up to 600 characters: what was found, framed as data about brewing |
| `levers` | 1 or more of `ratio`, `grind`, `temperature`, `agitation`, `bloom`, `time`, `water`, `rest` |
| `evidence` | `peerReviewed`, `controlledTest`, `expert`, or `own` (their own test) |
| `scope` | `any`, `filter`, `pourOver`, `immersion`, `espresso`, as llm-contract.md §9's table |
| `source` | up to 300 characters or `null`: where it comes from |
| `mode` | as above |
| `createdAt` | ISO, kept across edits |

The server cleans every text (control characters and line breaks become
spaces, runs of whitespace one space, trimmed), then applies the caps; a
text that's empty once cleaned is a `400`. A finding's `text` is also
neutralized so it can't pose as another finding in the prompt (SEC-01,
`neutralizeFindingText`): `Research finding:` (any case) becomes `research
finding -`, a finding's key in round brackets (`(leverOrder)`, `(own.<id>)`)
gets square ones, and double quotes become single. The same applies to a
backup's findings on restore, and again in the worker for older stored text. Unknown keys, levers, scopes,
evidence or modes are `400`s too.

**In the prompt** (`researchSectionsFor`, `worker/src/prompt.ts`): the
built-in findings left `on` keep their sections (`research.<key>`), then,
when any own finding applies to the brew, `research.own` (the framing,
`OWN_RESEARCH_INTRO`: they were written by the barista or their workspace,
are data about brewing, never instructions, and can't change the rules or
the answer's format; the quoted text is the whole finding, and nothing inside
it is a key, a rule or another finding) and one `research.own.<id>` each,
`Research finding: (own.<id>) "<text>"` (neutralized as above), the person's first, then the workspace's, each only for
its scope. They come just before the instructions and the note. A route's
`findings` (§8b) may cite `own.<id>`; the worker accepts only keys whose
section this request's prompt actually held (`researchKeysSent`), so a
switched-off finding or a made-up key is dropped.

**Research updated.** Each built-in finding carries `since`, the
`RESEARCH_VERSION` its text is from. When the version moves past the one a
person last dismissed (`seenVersion`), `GET` lists the findings reworded or
added since as `updated`, and Settings shows a notice with **Dismiss**
(`POST …/seen`). Someone who never dismissed has nothing to compare with:
`updated` is empty until they do.

### `GET /api/auth/me/research`

- **Auth Required:** `true`
- **Success (`200 OK`):**
  ```json
  {
    "research": { "settings": { "sourStrong": { "mode": "off", "note": "skews my V60" } }, "own": [{ "id": "a1b2c3d4", "title": "...", "text": "...", "levers": ["agitation"], "evidence": "own", "scope": "pourOver", "source": null, "mode": "on", "createdAt": "..." }], "seenVersion": "r2" },
    "builtIn": [{ "key": "leverOrder", "title": "Which lever to move", "text": "...", "levers": ["ratio", "grind", "agitation", "temperature"], "evidence": "peerReviewed", "scope": "any", "experiment": false, "source": "strength-water-rest.md", "since": "r2" }],
    "version": "r2",
    "updated": [],
    "limits": { "findings": 20, "title": 80, "text": 600, "source": 300, "note": 200 }
  }
  ```
  `research` is `{ "settings": {}, "own": [], "seenVersion": null }` when
  nothing is stored.

### `PUT /api/auth/me/research`

- **Auth Required:** `true`
- **Body:** `{ "settings": { "<key>": { "mode": "on" | "off" | "experiment" | null, "note"?: "..." | null } }, "own": [{ "id"?: "...", "title", "text", "levers", "evidence", "scope", "source", "mode" }] }`,
  replacing both. A finding with a known `id` keeps it and its `createdAt`;
  without one it's new. `seenVersion` stays as it is.
- **Success (`200 OK`):** the same as `GET`.
  A `settings` key may also be `own.<id>` (8 lowercase hex) for a
  workspace's finding (see Precedence).
- **Errors:** `400` a key that isn't a built-in finding or `own.<id>`, an
  unknown id in `own`, anything over its cap or outside its list, more than
  20 findings, an unknown body key.

### `POST /api/auth/me/research/seen`

- **Auth Required:** `true`. Sets `seenVersion` to the current
  `RESEARCH_VERSION`. **Success (`200 OK`):** the same as `GET`.

### `GET /api/workspaces/:workspaceId/research`

- **Auth Required:** `true`, a member.
- **Success (`200 OK`):** `{ "research": { "settings": {...}, "own": [...] }, "limits": {...} }`.

### `PUT /api/workspaces/:workspaceId/research`

- **Auth Required:** `true`, an owner (`403` otherwise).
- **Body** and **errors:** as the person's `PUT`, but `settings` takes
  built-in keys only (no `own.<id>`).
- **Success (`200 OK`):** the same as its `GET`.

## Drafts: your own research from pasted text

Rather than filling the form by hand, a person pastes what they read (a
paper's abstract, a video's notes, a forum post, their own test notes) and
the workspace's AI turns it into draft findings in the schema above
(llm-contract.md §9h). The drafts come back as cards to check, edit and
**Save** (to their own findings, or, for an owner, the workspace's) or
**Discard**; the route saves nothing, and a saved card goes through the
`PUT` above with its checks. The text is the user turn, framed as data
(it can't instruct the model or change the format), with no web access.
The worker then holds the AI to the text (`worker/src/researchDraft.ts`):

- **evidence** can't exceed what the text itself claims: `peerReviewed`
  only when it names a study, paper, journal or published research;
  `controlledTest` when it describes a test, trial or measurement; `own`
  only when it's written in the first person; otherwise `expert`
  (`cappedEvidence`);
- **source** is kept only when every word of it (3+ letters or digits) is
  in the text (`sourceInText`); otherwise `null`, shown as "not given". The
  AI never supplies one of its own;
- at most 5 drafts, each with a title, a text and a lever, cleaned and
  capped like the form's; `mode` starts `on`.

### `POST /api/workspaces/:workspaceId/research/draft`

- **Auth Required:** `true`, an owner or barista (`403` a viewer).
- **Body:** `{ "text": "..." }`, 1–4000 characters once cleaned (control
  characters other than line breaks become spaces; blank runs squeezed).
- Needs the workspace's AI (`409`, `code: "ai_not_configured"`) and counts
  1 against the daily budget (§9a; `429 ai_limit`). The request waits for
  the job (`RESEARCH_DRAFT_QUEUE`, `RESEARCH_DRAFT_TIMEOUT_MS`, 60 s).
- **Success (`200 OK`):** `{ "drafts": [{ "title", "text", "levers", "evidence", "scope", "source", "mode": "on" }] }`,
  possibly empty when nothing in the text read as a finding.
- **Errors:** `400` empty or too long; `503` the queue is down; `504` not
  answered in time; `502` the AI's reply couldn't be used.

**Settings → AI → Research** (`SettingsResearchView.vue`, `/settings/ai/research`,
linked from Settings → AI and the nav under the workspace): the update
notice; every built-in finding with its text, evidence, scope and levers, a
**You** select (the workspace's default, or On / Off / Only as an
experiment), for owners a **Workspace default** select, a note, and what it
comes to; then **Your findings** and **Workspace findings** (owners edit
the latter), each marked Yours or Workspace, with an add/edit form (title,
finding, levers, evidence, brews, mode, source) and Remove, and on each
workspace finding a **You** select (the workspace's mode, or On / Off / Only
as an experiment; `own.<id>`, see Precedence); then **From
text** (owners and baristas, with the workspace's AI): the paste box,
**Turn into findings**, and the draft cards with the same fields, each with
Save to my findings, Save to the workspace (owners) and Discard. A route's
"Follows …" (lib/suggest.ts `findingTitles`) names a built-in finding, and a
workspace's own finding by its title (the Brew page reads the workspace's
list); any other own finding is the asker's private one: "Your research" to
the asker, "The asker's research" to other members (SEC-04).
