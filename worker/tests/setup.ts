// Runs before each test file, before worker modules are imported (config.ts
// reads the environment at import time).
import { afterAll, beforeEach } from "vitest";
import { resetTestData } from "../../testing/db.js";
import { applyTestEnv } from "../../testing/test-env.js";

applyTestEnv();

beforeEach(async () => {
  await resetTestData();
});

afterAll(async () => {
  const { pool } = await import("../src/db.js");
  await pool.end();
});
