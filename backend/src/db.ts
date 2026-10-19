import { connectionSettings } from "@barista/shared/env";
import * as schema from "@barista/shared/schema";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

// Password comes separately (DATABASE_PASSWORD or DATABASE_PASSWORD_FILE) so
// DATABASE_URL itself never holds a secret. Not part of config.ts so the
// migration runner can use it without JWT/Redis settings.
export const databaseSettings = connectionSettings("DATABASE_URL", "DATABASE_PASSWORD");

export const pool = mysql.createPool({
  uri: databaseSettings.url,
  ...(databaseSettings.password ? { password: databaseSettings.password } : {}),
});

// "default" mode targets standard MySQL/MariaDB (not PlanetScale)
export const db = drizzle(pool, { schema, mode: "default" });

export type Database = typeof db;
