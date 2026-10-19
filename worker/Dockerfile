# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f worker/Dockerfile .
# (npm workspaces share the root lockfile, and the worker depends on shared/.)

FROM node:22-alpine AS build
WORKDIR /app
# Every workspace's package.json must be present for `npm ci` to match the lockfile.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY worker/package.json worker/
COPY frontend/package.json frontend/
RUN npm ci -w worker -w @barista/shared
COPY shared/ shared/
COPY worker/ worker/
# tsc -b builds shared first (project reference), then the worker.
RUN npm run build -w worker

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY worker/package.json worker/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w worker -w @barista/shared && npm cache clean --force
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/worker/dist worker/dist
USER node
WORKDIR /app/worker
# Exec form: node is PID 1 and gets SIGTERM, so active jobs finish before exit.
CMD ["node", "dist/worker.js"]
