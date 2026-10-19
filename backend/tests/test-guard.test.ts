// The suite wipes its database before every test, so it must refuse anything
// that isn't a *_test database (or Redis db 1).
import { afterEach, expect, it } from "vitest";
import { assertTestDatabase } from "../../testing/test-env.js";

const original = { db: process.env.DATABASE_URL, redis: process.env.REDIS_URL };
afterEach(() => {
  process.env.DATABASE_URL = original.db;
  process.env.REDIS_URL = original.redis;
});

it("is pointed at the test database right now", () => {
  expect(original.db).toMatch(/\/coffee_journal_test$/);
  expect(() => assertTestDatabase()).not.toThrow();
});

it.each([
  "mysql://barista@localhost:3306/coffee_journal",
  "mysql://barista@db:3306/coffee_journal",
  "mysql://barista@localhost:3306/coffee_journal_test_backup",
])("refuses %s", (url) => {
  process.env.DATABASE_URL = url;
  expect(() => assertTestDatabase()).toThrow(/must end in _test/);
});

it("refuses the app's Redis database 0", () => {
  process.env.REDIS_URL = "redis://localhost:6379/0";
  expect(() => assertTestDatabase()).toThrow(/database 1/);
});
