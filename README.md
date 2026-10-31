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
3. **Start it:** `docker compose up -d --build`. `docker compose ps` should
   show every service running, and db, redis and backend healthy. The
   containers restart on their own, after a reboot too, as long as Docker
   starts at boot.
4. **Trust the CA** on each device and install the app (next section).

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
   there (steps above), restore the dump as `docs/api/server.md` "Restoring
   a dump" says, with `move.sql.gz` as the file, and only then put the
   photos in its photos folder: when the backend starts, it deletes photos
   no row points at.
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
- every `*_DIR` setting, which is required here. Docker creates the folders
  and the app sets their owner when it starts.

It doesn't map ports 3000, 3306 or 6379 on the host, and it has no test
database.

**Updating:** pull the images and start the stack again (`docker compose
pull`, then `up -d`). The backend migrates the database when it starts, so
take a backup first when a new build changes the schema. Going back to an
older build after that means restoring a dump, not just changing the tag.

## Install it on your phone

The app installs as a PWA, which needs HTTPS and a certificate the device
really trusts: clicking through a browser warning isn't enough. There are two
ways to get that:

- **Built in (below):** the frontend container serves HTTPS with certificates
  from its own CA, and each device trusts that CA once. Nothing else needed.
- **Your own reverse proxy:** next section. Use this if you already have one,
  or want an address with no port.

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

The CA lives in the `caddy_data` Docker volume (or `CADDY_DATA_DIR`) and lasts
ten years; keep it, or every device has to trust a new one.

The certificate only covers `localhost` and `APP_HOST`, so open the app at
exactly that address. Any other name for the same server fails with
`SSL_ERROR_INTERNAL_ERROR_ALERT` in Firefox. To change the address, update
`APP_HOST` and `APP_URL` and recreate the containers.

## Behind a reverse proxy

To use an address with no port, such as `https://coffee.server.lan`, put a
reverse proxy like Nginx Proxy Manager in front. The app still runs its own
HTTPS, so the proxy talks HTTPS to it, unlike most self-hosted apps.

1. Point the name at the proxy, for example with a local DNS record in
   Pi-hole.
2. In `.env`, set `APP_HOST` and `APP_URL` to the name, with no port:
   ```sh
   APP_HOST=coffee.server.lan
   APP_URL=https://coffee.server.lan
   ```
   Then recreate the containers. The app needs `HTTPS_PORT` to be free on the
   server, as usual.
3. Add a proxy host for the name, forwarding to the server's IP and
   `HTTPS_PORT` with the scheme set to **https**. With `http` you get "Client
   sent an HTTP request to an HTTPS server." `HTTP_PORT` won't work here: it
   only redirects and serves the CA. The proxy doesn't need to verify the
   app's certificate.
4. Give the proxy host a certificate for the name that your devices trust, and
   force SSL. Without HTTPS the page may load, but login fails, because the
   session cookie is HTTPS-only.
   - **A public domain:** a Let's Encrypt certificate works, using a DNS
     challenge if the server isn't reachable from the internet.
   - **A local name (`.lan`):** Let's Encrypt won't issue one. Make one with
     [mkcert](https://github.com/FiloSottile/mkcert) (`mkcert coffee.server.lan`,
     or reuse a wildcard), upload it to the proxy as a custom certificate, and
     trust mkcert's root CA on each device, phones included.
5. Open `https://coffee.server.lan` and install it as above. You don't need
   the app's own CA on your devices, because they only see the proxy's
   certificate.

With a proxy in front, the backend sees every request as coming from the
proxy, so all devices share one login rate limit. Keep the proxy on your own
network or VPN unless you've closed sign-ups (`ALLOW_REGISTRATION=false`).
