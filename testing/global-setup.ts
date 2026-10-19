// Vitest globalSetup: runs once per suite, before any test file.
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { testConnectionOptions } from "./db.js";
import { applyTestEnv, TEST_DATABASE } from "./test-env.js";

export default async function setup(): Promise<void> {
  applyTestEnv();
  let connection: mysql.Connection;
  try {
    connection = await mysql.createConnection(testConnectionOptions());
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ER_DBACCESS_DENIED_ERROR" || code === "ER_BAD_DB_ERROR") {
      throw new Error(`Test database ${TEST_DATABASE} doesn't exist yet. Run: npm run test:db:create`);
    }
    if (code === "ECONNREFUSED") {
      throw new Error("Can't reach MariaDB on localhost:3306. Start it with: docker compose up -d db redis");
    }
    throw err;
  }
  try {
    const migrationsFolder = fileURLToPath(new URL("../backend/drizzle", import.meta.url));
    await migrate(drizzle(connection), { migrationsFolder });
  } finally {
    await connection.end();
  }
}
