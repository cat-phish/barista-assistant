import { defineConfig } from "vitest/config";

// Needs the db and redis containers running (docker compose up -d db redis)
// and the test database created once (npm run test:db:create).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["../testing/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // One shared test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
