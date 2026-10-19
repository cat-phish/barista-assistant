# syntax=docker/dockerfile:1
# Development image: runs the Vite dev server (matches docker-compose.yml's
# port 5173). Build from the repo root: docker build -f frontend/Dockerfile .

FROM node:22-alpine
# Owned by `node` so Vite can write its cache under node_modules/.vite.
RUN mkdir /app && chown node:node /app
USER node
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node shared/package.json shared/
COPY --chown=node:node backend/package.json backend/
COPY --chown=node:node worker/package.json worker/
COPY --chown=node:node frontend/package.json frontend/
RUN npm ci -w frontend
COPY --chown=node:node frontend/ frontend/
WORKDIR /app/frontend
EXPOSE 5173
# --host so the server is reachable from outside the container.
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]
