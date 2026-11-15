// Runs before each test file, before the app is imported (config.ts reads
// the environment at import time).
import { afterAll, beforeEach } from "vitest";
import { resetTestData } from "../../testing/db.js";
import { applyTestEnv } from "../../testing/test-env.js";

applyTestEnv();
// Tests register many users from one IP; sec-register-rate.test.ts sets the real cap.
process.env.REGISTER_LIMIT_PER_HOUR ??= "10000";
process.env.INVITE_LIMIT_PER_HOUR ??= "10000";
process.env.HEAVY_IMPORT_LIMIT_PER_HOUR ??= "10000";
process.env.TEST_SEND_LIMIT_PER_HOUR ??= "10000";
process.env.MAX_OWNED_WORKSPACES ??= "10000";
process.env.AI_DAILY_USER_UNITS ??= "100000";
process.env.AI_DAILY_WORKSPACE_UNITS ??= "100000";

beforeEach(async () => {
  await resetTestData();
});

afterAll(async () => {
  // Close connections so the test process exits cleanly.
  const [{ pool }, { closeQueue }] = await Promise.all([import("../src/db.js"), import("../src/queue.js")]);
  await Promise.allSettled([pool.end(), closeQueue()]);
});
