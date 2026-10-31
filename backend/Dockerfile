# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f backend/Dockerfile .
# (npm workspaces share the root lockfile, and the backend depends on shared/.)

FROM node:22-alpine AS build
WORKDIR /app
# Every workspace's package.json must be present for `npm ci` to match the lockfile.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY worker/package.json worker/
COPY frontend/package.json frontend/
RUN npm ci -w backend -w @barista/shared
COPY shared/ shared/
COPY backend/ backend/
# tsc -b builds shared first (project reference), then the backend.
RUN npm run build -w backend

FROM node:22-alpine
RUN apk add --no-cache su-exec
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY worker/package.json worker/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w backend -w @barista/shared && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/backend/dist backend/dist
COPY backend/drizzle backend/drizzle
# Starts as root to take ownership of DATA_DIRS, then runs as node (docker/entrypoint.sh).
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/app-entrypoint
ENV DATA_DIRS=/photos
ENTRYPOINT ["app-entrypoint"]
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
# Migrate, then exec so node is PID 1 and receives SIGTERM for graceful shutdown.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/index.js"]
