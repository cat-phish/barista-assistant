import { defineConfig } from 'vitest/config';

// Unit tests for pure helpers (no DOM needed).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
