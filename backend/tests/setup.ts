// Runs before each test file, before the app is imported (config.ts reads
// the environment at import time).
import { afterAll, beforeEach } from "vitest";
import { resetTestData } from "../../testing/db.js";
import { applyTestEnv } from "../../testing/test-env.js";

applyTestEnv();

beforeEach(async () => {
  await resetTestData();
});

afterAll(async () => {
  // Close connections so the test process exits cleanly.
  const [{ pool }, { closeQueue }] = await Promise.all([import("../src/db.js"), import("../src/queue.js")]);
  await Promise.allSettled([pool.end(), closeQueue()]);
});
