// Security audit session 4. SEC-30, SEC-32 (register half). Own file: the limiter's counters are per file.
import { expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.REGISTER_LIMIT_PER_HOUR = "5";
});
import request from "supertest";
import { app } from "../src/app.js";

// SEC-32 (register half): covered in email-verification.test.ts. With mail
// verification on, a taken address gets the same 202 as a new one; without it
// (no SMTP) it's still a 409 and the cap below (SEC-30) slows enumeration.

// SEC-30: POST /register has no rate limit.
it("SEC-30 rate-limits register: the 6th sign-up from one IP in a minute is 429", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await request(app).post("/api/auth/register").send({ email: `flood${i}@example.com`, password: "correct-horse-battery" });
    statuses.push(res.status);
  }
  expect(statuses[5]).toBe(429);
});
