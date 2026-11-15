// Security audit session 4. SEC-33, SEC-34 (backend half).
import { expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { newUser } from "./helpers.js";

// SEC-33: logout doesn't revoke the token.
it("SEC-33 a copied session cookie stops working after logout", async () => {
  const user = await newUser();
  const login = await request(app).post("/api/auth/login").send({ email: user.email, password: user.password });
  expect(login.status).toBe(200);
  const cookie = (login.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
  await request(app).post("/api/auth/logout").set("Cookie", cookie);
  expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
});

// SEC-34: no nosniff on API responses.
it("SEC-34 API responses carry X-Content-Type-Options: nosniff", async () => {
  const res = await request(app).get("/api/auth/registration");
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
});
