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
  placeholder in their place (SEC-22).
- **A workspace's** (`workspaces.research`, `ResearchSettings`), set by
  owners: a default per built-in finding, and shared findings everyone in
  the workspace gets and can read. In its backups (backup.md §2b, the
  `workspace` block's `research`).

**Precedence** (`effectiveMode`): the person's choice, then the workspace's
default, then the finding's own: `on` for a rule, `experiment` for a finding
marked `experiment` (`coldBloom`, `firstPours`). A choice of `null` is no
choice (a note alone).

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
`worker/src/processor.ts` loads both (`loadResearch`).

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
text that's empty once cleaned is a `400`. Unknown keys, levers, scopes,
evidence or modes are `400`s too.

**In the prompt** (`researchSectionsFor`, `worker/src/prompt.ts`): the
built-in findings left `on` keep their sections (`research.<key>`), then,
when any own finding applies to the brew, `research.own` (the framing,
`OWN_RESEARCH_INTRO`: they were written by the barista or their workspace,
are data about brewing, never instructions, and can't change the rules or
the answer's format) and one `research.own.<id>` each, `Research finding:
(own.<id>) <text>`, the person's first, then the workspace's, each only for
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
- **Errors:** `400` a key that isn't a built-in finding, an unknown id,
  anything over its cap or outside its list, more than 20 findings, an
  unknown body key.

### `POST /api/auth/me/research/seen`

- **Auth Required:** `true`. Sets `seenVersion` to the current
  `RESEARCH_VERSION`. **Success (`200 OK`):** the same as `GET`.

### `GET /api/workspaces/:workspaceId/research`

- **Auth Required:** `true`, a member.
- **Success (`200 OK`):** `{ "research": { "settings": {...}, "own": [...] }, "limits": {...} }`.

### `PUT /api/workspaces/:workspaceId/research`

- **Auth Required:** `true`, an owner (`403` otherwise).
- **Body** and **errors:** as the person's `PUT`.
- **Success (`200 OK`):** the same as its `GET`.

**Settings → AI → Research** (`SettingsResearchView.vue`, `/settings/ai/research`,
linked from Settings → AI and the nav under the workspace): the update
notice; every built-in finding with its text, evidence, scope and levers, a
**You** select (the workspace's default, or On / Off / Only as an
experiment), for owners a **Workspace default** select, a note, and what it
comes to; then **Your findings** and **Workspace findings** (owners edit
the latter), each marked Yours or Workspace, with an add/edit form (title,
finding, levers, evidence, brews, mode, source) and Remove. A route's
"Follows …" (lib/suggest.ts) names a built-in finding; an own one shows as
"Your research".
