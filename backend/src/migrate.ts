// Applies pending migrations from ./drizzle, then exits. Runs before the
// server in the Docker image; uses the same __drizzle_migrations table as
// `npm run db:migrate` (drizzle-kit), so the two are interchangeable.
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { connectionSettings } from "@barista/shared/env";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

const { url, password } = connectionSettings("DATABASE_URL", "DATABASE_PASSWORD");

// dist/migrate.js -> ../drizzle (works from src/ under tsx as well)
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

const connection = await mysql.createConnection({ uri: url, ...(password ? { password } : {}) });
try {
  await migrate(drizzle(connection), { migrationsFolder });
  console.log("Migrations up to date");
} finally {
  await connection.end();
}
