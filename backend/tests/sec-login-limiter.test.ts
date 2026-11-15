// Security audit session 4. SEC-31. Own file: limiter counters are per file.
import { expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { newUser } from "./helpers.js";

// SEC-31: the limiter keys on IP only, so one account's failures lock out others on the same IP.
it("SEC-31 failed logins for one account don't block a correct login for another", async () => {
  const a = await newUser();
  const b = await newUser();
  for (let i = 0; i < 10; i++) await request(app).post("/api/auth/login").send({ email: a.email, password: "wrong-password" });
  const res = await request(app).post("/api/auth/login").send({ email: b.email, password: b.password });
  expect(res.status).toBe(200);
});

it("SEC-31 failures against one account are throttled from a second IP too", async () => {
  app.set("trust proxy", 1); // as docker-compose sets TRUST_PROXY=1
  const a = await newUser();
  for (let i = 0; i < 10; i++) await request(app).post("/api/auth/login").set("X-Forwarded-For", "203.0.113.1").send({ email: a.email, password: "wrong-password" });
  const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", "203.0.113.2").send({ email: a.email, password: "wrong-password" });
  expect(res.status).toBe(429);
});
