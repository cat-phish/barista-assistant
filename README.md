# Barista-Assistant

> [!WARNING]
> This app is in rapid development and isn't ready for production. Features
> and the database schema change often, and updates may break things. Keep
> backups of your data if you run it.

A self-hosted coffee journal: brew timer, beans, recipes and roasts, AI brew
analysis, and a menu for your bar. What it does: `docs/features.md`.

## Run it

1. `cp .env.example .env && chmod 600 .env`, then fill in the secrets and
   `OPENAI_MODEL` (the file says how).
2. `docker compose up -d --build`
3. Open https://localhost:42069. The certificate comes from the app's own CA, so
   the browser warns until you trust it (below).

Code changes need `docker compose up -d --build` again: the images copy the
source in. For live reload, run `npm run dev` in `frontend/` on the host
(with the backend running).

## Run it on a server

Any machine with Docker Engine and the Compose plugin: `docker compose
version` should print v2, and `docker buildx version` should work (the
images are built on the server).

1. **Get the code:** `git clone <this repo> barista-assistant && cd
   barista-assistant`.
2. **Configure it:** `cp .env.example .env && chmod 600 .env`, then set:
   - the secrets and `OPENAI_MODEL`, as the file says. Moving from another
     machine? Copy its `JWT_SECRET` to keep everyone logged in;
   - `FRONTEND_BIND=0.0.0.0`, `APP_HOST` to the server's LAN IP or a name
     your network resolves, and `APP_URL=https://<that address>:42069`. The HTTPS
     certificate is made for that address, so give the server a fixed IP
     (e.g. a DHCP reservation on the router);
   - if something else on the server already uses port 42069 or 42070:
     `HTTPS_PORT` / `HTTP_PORT` (e.g. 8443 / 8080), and the port in
     `APP_URL` (`https://192.168.1.20:8443`);
   - optionally, where data is kept (`DB_DATA_DIR` and the rest, under
     "Where data is kept"). The defaults are Docker volumes and the
     `photos/` and `backups/` folders here;
   - `ALLOW_REGISTRATION=false` once the accounts exist, if the server is
     reachable by people who shouldn't sign up; `BREW_TIMEZONE` and
     `BACKUP_TIMEZONE`.
3. **Let the app write its folders:** the backend and worker run as uid
   1000. `sudo chown 1000:1000 photos backups` (or the `PHOTOS_DIR` and
   `BACKUPS_DIR` folders you set; create them first).
4. **Start it:** `docker compose up -d --build`. `docker compose ps` should
   show every service running, and db, redis and backend healthy. The
   containers restart on their own, after a reboot too, as long as Docker
   starts at boot.
5. **Trust the CA** on each device and install the app (next section).

**Updating:** `git pull && docker compose up -d --build`. The backend
applies new database migrations when it starts. Open apps pick up the new
version on their own, but never mid-brew.

**Moving from another machine:**
1. On the old one, stop the app (so nothing is logged after the dump),
   dump the database, then stop the rest:
   ```sh
   docker compose stop frontend backend worker
   docker compose exec -T db sh -c 'mariadb-dump --single-transaction --no-tablespaces \
     -uroot -p"$(cat /run/secrets/db_root_password)" coffee_journal' | gzip > move.sql.gz
   docker compose down
   ```
2. Copy `move.sql.gz` and the `photos/` folder to the server. Start the app
   there (steps above), put the photos in its photos folder (owned by uid
   1000), then restore the dump as `docs/api/server.md` "Restoring a dump"
   says, with `move.sql.gz` as the file.
3. Devices trust the new server's CA (it's a new one) and install the app
   again from the new address.

## Run the published images

Docker Hub has images of each branch, so a server needs no copy of the repo
and builds nothing. Use `docker-compose.release.yml` in place of
`docker-compose.yml`: paste it into a Compose Manager stack on Unraid, or
run it with `docker compose -f docker-compose.release.yml up -d`.

In `.env` (Compose Manager's ENV File), set what "Run it on a server" lists,
plus:

- `IMAGE_TAG`: `latest` (the default, from `main`), `testing`, `dev`, or a
  fixed build such as `sha-7a093cd`;
- every `*_DIR` setting, which is required here. Create the photos and
  backups folders and `chown 1000:1000` them.

It doesn't map ports 3000, 3306 or 6379 on the host, and it has no test
database.

**Updating:** pull the images and start the stack again (`docker compose
pull`, then `up -d`). The backend migrates the database when it starts, so
take a backup first when a new build changes the schema. Going back to an
older build after that means restoring a dump, not just changing the tag.

## Install it on your phone

The app installs as a PWA, which needs HTTPS. The frontend container
serves it over HTTPS with certificates from its own CA; each device trusts
that CA once.

1. In `.env`, set `FRONTEND_BIND=0.0.0.0`, `APP_HOST` to this machine's LAN
   IP (or a name your network resolves) and `APP_URL=https://<that address>:42069`,
   then `docker compose up -d --build`.
2. On the phone, open `http://<address>:42070/ca.crt` and trust it:
   - **Android:** Settings → Security → Encryption & credentials → Install a
     certificate → **CA certificate** (the path varies by phone).
   - **iOS:** allow the profile download, install it under Settings →
     General → VPN & Device Management, then turn on full trust under
     Settings → General → About → Certificate Trust Settings.
   - **A computer:** import it in the browser's certificate settings as an
     authority.
3. Open `https://<address>:42069` and install it: Chrome's menu → **Install app**
   (Android), or Share → **Add to Home Screen** (iOS Safari).

The CA lives in the `caddy_data` Docker volume and lasts ten years; keep
the volume, or every device has to trust a new one.
