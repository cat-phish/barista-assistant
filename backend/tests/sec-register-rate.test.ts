// Security audit session 4. SEC-30, SEC-32 (register half). Own file: the limiter's counters are per file.
import { expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

// SEC-30: POST /register has no rate limit.
it("SEC-30 rate-limits register: the 6th sign-up from one IP in a minute is 429", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await request(app).post("/api/auth/register").send({ email: `flood${i}@example.com`, password: "correct-horse-battery" });
    statuses.push(res.status);
  }
  expect(statuses[5]).toBe(429);
});

// SEC-32: a duplicate email answers differently from a new one.
it("SEC-32 register answers a duplicate email the same way as a new one", async () => {
  const body = { email: "dup-enum@example.com", password: "correct-horse-battery" };
  const first = await request(app).post("/api/auth/register").send(body);
  const second = await request(app).post("/api/auth/register").send(body);
  expect(second.status).toBe(first.status);
});
