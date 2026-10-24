# Coffee Brew Journal PWA - Agent Instructions

## The Stack (npm workspaces monorepo)

- **Frontend (`/frontend`):** Vue 3 (`<script setup lang="ts">`), Vite, Pinia,
  Vue Router, `vite-plugin-pwa`.
- **Backend (`/backend`):** Node.js, TypeScript, Express, Drizzle ORM,
  `mysql2`.
- **Worker (`/worker`):** Node.js, TypeScript, Redis, BullMQ, OpenAI/LLM SDK
  (Structured Outputs).
- **Shared (`/shared`, package `@barista/shared`):** Drizzle schema
  (`@barista/shared/schema`) and BullMQ job contracts (`@barista/shared/jobs`)
  used by backend and worker. Built with `tsc -b`; backend and worker reference
  it as a TypeScript project, so their `npm run build` builds it first.
- **Database & Infrastructure:** MariaDB and Redis via root
  `docker-compose.yml`.

## Development Rules

1. **Spec First (Progressive Disclosure):** Before writing code for a feature,
   read the corresponding specification file. Do not deviate from defined
   schemas or contracts without asking:
   - Database models & migrations: read `docs/schema.md`.
   - API routes, public menu & LLM worker jobs: read `docs/api/README.md`
     (conventions + a § → file index), then only the section file(s) you
     need, e.g. `docs/api/drinks.md` for §5c. Update those files when a
     contract changes, and cite `docs/api/<file>.md §N` in code comments.
   - PWA config, mobile viewport & pour-over timer UI: read
     `docs/timer_architecture.md`.
   - Planned features and ideas: read `docs/backlog.md` when asked to review
     or pick upcoming work, and update it when plans change.
2. **Small Diffs:** Implement one feature or route at a time. Plan your steps
   before writing code and avoid massive multi-file refactors.
3. **TypeScript Strict:** Use strict mode. Define proper interfaces for all API
   payloads and infer types from Drizzle schemas where possible. No `any`
   types.
4. **Verification:** Never assume code works.
   - Backend/Worker: run `npx tsc --noEmit` or `npm run build` in the
     respective folder to verify compilation.
   - Frontend: run `npm run build` in `/frontend` to verify Vite compiles.
   - Run `npm test` at the repo root (backend + worker suites). Needs the db
     and redis containers up; first time only: `npm run test:db:create`.
     Tests use `coffee_journal_test` and Redis db 1, never the real data.
     Add or update tests with every API or worker change.
5. **No Secrets:** Never commit `.env` files or hardcode API keys/passwords.
   Always use `process.env`.
   - Commits are scanned by a gitleaks pre-commit hook (`.githooks/pre-commit`,
     rules in `.gitleaks.toml`; `npm install` enables it). Never bypass it
     with `--no-verify`. If it flags something, remove the secret; for a
     genuine false positive, ask before adding an allowlist entry.
6. **Hideable and repeatable fields:** every new optional field on the
   brew, bean or recipe forms gets an entry in the field registry
   (`frontend/src/lib/fields.ts`) and a `show('<key>')` in its form, so a
   workspace can hide it under Settings → Fields (`docs/api/workspaces.md`
   §2, "Field visibility"). A new **brew** field also needs an entry in
   `REPEAT_FOR_FIELD` (`frontend/src/lib/repeatBrew.ts`): either the Repeat
   brews option that copies it (add one to `REPEAT_KEEPS` and
   `REPEAT_OPTIONS`, and apply it in `applyRepeat`), or `'result'` if it's
   measured each time and never copied (`docs/api/auth.md` §1
   repeatKeeps). The type and a test fail until it's there.
7. **Confirming major actions:** an action that can't be undone, or that
   affects other things or other people (deleting something others use,
   deleting a workspace, leaving one, …), confirms in a dialog with a red
   action button and an **"I understand"** checkbox that must be ticked
   before the button works (the pattern in `DeleteDialog.vue`). Used today
   by: deleting anything something else uses (`DeleteDialog.vue`), deleting
   a bean with its brew history, deleting a drink category, changing the
   workspace's web address, deleting or leaving a workspace, removing a
   member, demoting yourself from owner, and deleting your account.
   Deliberately without it: deleting a brew log, deleting a menu section,
   abandoning a brew, and deleting things nothing uses. When building or
   changing an action that seems to qualify, **ask the user before adding
   the checkbox** to it; don't add it unasked.
8. **Backups cover every table:** a new table in the schema goes into a
   workspace backup (`BACKUP_TABLES` in `backend/src/backup.ts`, in insert
   order, with its enum and JSON columns) or is left out on purpose
   (`NOT_BACKED_UP`), per `docs/api/backup.md` §2b, and a top-level one
   needs a match key for imports (`MATCH_KEYS` in
   `backend/src/listImport.ts`). `backup.test.ts` and
   `list-import.test.ts` fail until it's decided.
9. **What the AI sees stays in step:** a field added to or removed from
   the analysis context (`worker/src/context.ts`) is either always sent or
   switchable under Settings → AI, decided in the same change: classify it
   in `worker/tests/aiDetails.test.ts` (its test typecheck fails until
   then), drop a switchable one in `toLlmInput` when its key is hidden, and
   update `docs/api/llm-contract.md` §9 "What the AI sees". A new key goes
   in `AI_DETAILS` (`@barista/shared/aiDetails`) and
   `frontend/src/lib/aiDetails.ts` with its label (a frontend test checks
   they match). Ask the user which it should be when it isn't obvious.
