# 10. Server Administration

> Part of the API spec. Conventions, auth rules and the section index are in
> [README.md](README.md); a bare `§N` refers to that index.

What applies to the whole server rather than a workspace. Only **server
admins** use it. The user object (§1) says `"isAdmin": true` for them, and
the app then shows Settings → Server. Everyone else gets `403` here.

## Server admins

Admin is a flag on the account (`users.is_admin`), granted **only on the
server**, never through the API, so it can't be claimed by registering an
address (emails aren't verified). The account must exist first:

```sh
docker compose exec backend npm run admin -- grant you@example.com
docker compose exec backend npm run admin -- revoke you@example.com
docker compose exec backend npm run admin -- list
```

(In development: `npx tsx src/cli/admin.ts grant …` in `backend/`.) It
takes effect on the next request; nobody is an admin until one is granted.

## On a server open to the internet

- `ALLOW_REGISTRATION=false` closes sign-ups (§1): create the accounts
  first, then close it. Existing accounts still log in.
- `BACKUP_DOWNLOADS=false` keeps dumps on the server: admins see and run
  backups but copy the files from `./backups` themselves.
- Downloading a dump always asks for the admin's password again.

## Scheduled database backups

A `mariadb-dump` of the whole database (every workspace and account),
gzipped into the backup folder (`./backups` next to `docker-compose.yml`,
mounted at `/backups`), on the admins' schedule. Unlike a workspace backup
(§2b) it's restored on the server, not in the app.

- **Settings** (`server_settings` key `"backups"`): `frequency` (`off`,
  `daily`, `weekly`), `hour` (0–23), `weekday` (0–6, Sunday first; weekly
  only), `keep` (1–90). Default off, 3 a.m., Sunday, 7. The hour is in
  `BACKUP_TIMEZONE` (default UTC).
- **Schedule:** a BullMQ job scheduler (`db-backup` on the `maintenance`
  queue, cron `0 <hour> * * *` or `0 <hour> * * <weekday>`), kept in step
  with the settings on every save and when the backend starts.
- **The dump** (worker, `worker/src/dbBackup.ts`): `mariadb-dump
  --single-transaction --no-tablespaces` as the app's database user (the
  password through `MYSQL_PWD`, not the command line), gzipped to
  `barista-db-YYYY-MM-DD-HHmmZ.sql.gz` (UTC) via a hidden `.partial` file
  that's renamed when complete. Then all but the newest `keep` dumps are
  deleted (other files in the folder are left alone). Failures are retried
  once, a minute later.
- **Status** (`server_settings` key `"backups_status"`): `lastRunAt`,
  `lastFile`, `lastBytes`, `lastError` (null after a success; after a
  failure the last good file stays named).

### `GET /api/server/backups`

- **Auth Required:** `true` (server admin)
- **Success (`200 OK`):**
  `{ "settings": {...}, "status": {...}, "timezone": "UTC", "nextRunAt": "ISO" | null, "files": [ { "name", "bytes", "createdAt" } ], "downloadsEnabled": true }`,
  files newest first (only names the worker writes).

### `PUT /api/server/backups/settings`

- **Auth Required:** `true` (server admin)
- **Body:** all four settings.
- **Success (`200 OK`):** the same as `GET`.
- **Errors:** `400`; `503` saved, but the schedule couldn't be updated
  (Redis down): save again.

### `POST /api/server/backups/run`

A dump now, outside the schedule. `202 { "queued": true }`; `503` if the
queue can't be reached. The result shows in `status` when it's done.

### `POST /api/server/backups/files/:name`

The dump as a download, after the admin's password again (a stolen session
alone isn't enough; rate-limited together with logins).

- **Body:** `{ "password": "…" }`
- **Errors:** `400` no password; `401` wrong password; `403` downloads are
  turned off (`BACKUP_DOWNLOADS=false`); `404` a name that isn't a dump file
  (so no paths) or doesn't exist; `429` too many tries.

It holds every account's data, including password hashes.

## Restoring a dump

It replaces the whole database. From the app's folder:

```sh
docker compose stop backend worker
gunzip -c backups/barista-db-2026-10-24-0300Z.sql.gz | docker compose exec -T db sh -c \
  'mariadb -uroot -p"$(cat /run/secrets/db_root_password)" coffee_journal'
docker compose start backend worker
```

The backend applies any newer migrations when it starts, so a dump from an
older version is brought up to date.
