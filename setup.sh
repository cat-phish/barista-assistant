#! /usr/bin/env bash

# 1. Create Monorepo Root
mkdir coffee-journal && cd coffee-journal
npm init -y

# Configure root package.json to manage dependencies via npm workspaces
npm pkg set workspaces.0="frontend" workspaces.1="backend" workspaces.2="worker"

# 2. Scaffold Vue 3 Frontend (Vite + TypeScript)
npm create vite@latest frontend -- --template vue-ts
cd frontend
npm install
npm install pinia vue-router
npm install -D vite-plugin-pwa
cd ..

# 3. Scaffold Backend (Express + Drizzle ORM + MySQL)
mkdir backend && cd backend
npm init -y
npm install express cors dotenv drizzle-orm mysql2
npm install -D typescript @types/node @types/express @types/cors tsx drizzle-kit
npx tsc --init
mkdir src
touch src/index.ts src/db.ts src/schema.ts
cd ..

# 4. Scaffold AI Worker (Redis/BullMQ)
mkdir worker && cd worker
npm init -y
npm install ioredis bullmq dotenv openai
npm install -D typescript @types/node tsx
npx tsc --init
mkdir src
touch src/worker.ts
cd ..

# 5. Create Root Configuration Files
touch docker-compose.yml CLAUDE.md .gitignore README.md
