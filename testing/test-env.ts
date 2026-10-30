// Test configuration for backend and worker suites. Reads the passwords from
// the root .env (the same one docker compose uses), then points everything at
// test-only resources so a test run can never touch real data:
//   MariaDB  coffee_journal_test (wiped before every test)
//   Redis    database 1 (the app uses 0; flushed before every test)
//   OpenAI   an unroutable URL, so an accidental real call fails fast
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

export const TEST_DATABASE = "coffee_journal_test";
const ROOT_ENV = fileURLToPath(new URL("../.env", import.meta.url));

export function applyTestEnv(): void {
  if (!existsSync(ROOT_ENV)) {
    throw new Error(`Tests read passwords from ${ROOT_ENV}, which doesn't exist (see .env.example).`);
  }
  const env = parse(readFileSync(ROOT_ENV));
  for (const name of ["MARIADB_PASSWORD", "REDIS_PASSWORD"]) {
    if (!env[name]) throw new Error(`${name} is not set in the root .env`);
  }

  // Overwrite (not default) so a DATABASE_URL in the shell can't redirect tests.
  for (const name of Object.keys(process.env)) {
    if (name.endsWith("_FILE")) delete process.env[name];
  }
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: `mysql://barista@localhost:3306/${TEST_DATABASE}`,
    DATABASE_PASSWORD: env.MARIADB_PASSWORD,
    REDIS_URL: "redis://localhost:6379/1",
    REDIS_PASSWORD: env.REDIS_PASSWORD,
    JWT_SECRET: randomBytes(32).toString("hex"),
    OPENAI_API_KEY: "sk-test-not-a-real-key",
    OPENAI_MODEL: "test-model",
    OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    // Photos go to a fresh folder per run, never the real ./photos.
    PHOTO_DIR: mkdtempSync(join(tmpdir(), "barista-photos-")),
  });
  assertTestDatabase();
}

// Last line of defense before anything destructive.
export function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run tests against database "${name}": its name must end in _test.`);
  }
  if (!(process.env.REDIS_URL ?? "").endsWith("/1")) {
    throw new Error("Refusing to run tests: REDIS_URL must use Redis database 1.");
  }
}
