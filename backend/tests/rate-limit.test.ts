// Own file: the limiter's in-memory counters live for the whole file (each
// test file gets a fresh module instance).
import { expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { newUser } from "./helpers.js";

it("blocks an IP after 10 failed password checks across login and password change", async () => {
  const user = await newUser();
  const bad = { email: user.email, password: "wrong-password" };

  // Successful logins don't count.
  for (let i = 0; i < 3; i++) expect((await request(app).post("/api/auth/login").send({ email: user.email, password: user.password })).status).toBe(200);

  for (let i = 0; i < 8; i++) expect((await request(app).post("/api/auth/login").send(bad)).status).toBe(401);
  // The password-change endpoint shares the counter.
  for (let i = 0; i < 2; i++) {
    expect((await user.agent.post("/api/auth/password").send({ currentPassword: "nope-nope", newPassword: "whatever-new" })).status).toBe(403);
  }

  const blocked = await request(app).post("/api/auth/login").send(bad);
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  // Even the right password is refused while blocked.
  expect((await request(app).post("/api/auth/login").send({ email: user.email, password: user.password })).status).toBe(429);
});
