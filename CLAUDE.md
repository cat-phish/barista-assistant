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
