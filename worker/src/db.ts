import * as schema from "@barista/shared/schema";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { config } from "./config.js";

export const pool = mysql.createPool({
  uri: config.database.url,
  ...(config.database.password ? { password: config.database.password } : {}),
});

// "default" mode targets standard MySQL/MariaDB (not PlanetScale)
export const db = drizzle(pool, { schema, mode: "default" });
