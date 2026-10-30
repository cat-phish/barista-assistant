# syntax=docker/dockerfile:1
# Production image: builds the app (the service worker and manifest only exist
# in a build) and serves it with Caddy over HTTPS, proxying /api to the
# backend (frontend/Caddyfile, docs/timer_architecture.md §2). For live reload
# while developing, run `npm run dev` in frontend/ on the host instead.
# Build from the repo root: docker build -f frontend/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY worker/package.json worker/
COPY frontend/package.json frontend/
RUN npm ci -w frontend
COPY frontend/ frontend/
WORKDIR /app/frontend
RUN npm run build

FROM caddy:2.10-alpine
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
EXPOSE 80 443
