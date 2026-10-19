import { Redis } from "ioredis";
import mysql from "mysql2/promise";
import { assertTestDatabase } from "./test-env.js";

export function testConnectionOptions(): mysql.ConnectionOptions {
  assertTestDatabase();
  return { uri: process.env.DATABASE_URL, password: process.env.DATABASE_PASSWORD };
}

// Empties every table except the migration journal, and Redis database 1.
export async function resetTestData(): Promise<void> {
  const connection = await mysql.createConnection(testConnectionOptions());
  try {
    const [rows] = await connection.query<mysql.RowDataPacket[]>("SHOW TABLES");
    const tables = rows.map((r) => String(Object.values(r)[0])).filter((t) => t !== "__drizzle_migrations");
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of tables) await connection.query(`TRUNCATE TABLE \`${table}\``);
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    await connection.end();
  }

  const redis = new Redis(process.env.REDIS_URL ?? "", { password: process.env.REDIS_PASSWORD, lazyConnect: true });
  try {
    await redis.connect();
    await redis.flushdb(); // database 1 only
  } finally {
    redis.disconnect();
  }
}
