import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { addMember, anonymous, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

describe("register / login / me / logout", () => {
  it("registers, normalizes the email, and sets an httpOnly session cookie", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "  Mixed@Example.COM ", password: "long-enough" });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("mixed@example.com");
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/session=.+; Max-Age=604800/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("rejects duplicates and invalid input", async () => {
    const user = await newUser();
    expect((await request(app).post("/api/auth/register").send({ email: user.email, password: "long-enough" })).status).toBe(409);
    expect((await request(app).post("/api/auth/register").send({ email: "x@example.com", password: "short" })).status).toBe(400);
    expect((await request(app).post("/api/auth/register").send({ email: "nope", password: "long-enough" })).status).toBe(400);
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    const user = await newUser();
    const wrong = await request(app).post("/api/auth/login").send({ email: user.email, password: "wrong-password" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "ghost@example.com", password: "wrong-password" });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("/me needs a valid session; logout clears it", async () => {
    const user = await newUser();
    expect((await user.agent.get("/api/auth/me")).body.user.id).toBe(user.id);
    expect((await anonymous().get("/api/auth/me")).status).toBe(401);
    const logout = await user.agent.post("/api/auth/logout");
    expect(logout.status).toBe(204);
    expect((await user.agent.get("/api/auth/me")).status).toBe(401);
  });
});

describe("change password", () => {
  it("revokes other sessions but keeps this one", async () => {
    const user = await newUser();
    const otherDevice = anonymous();
    expect((await otherDevice.post("/api/auth/login").send({ email: user.email, password: user.password })).status).toBe(200);

    const res = await user.agent.post("/api/auth/password").send({ currentPassword: user.password, newPassword: "a-brand-new-one" });
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/session=.+/); // fresh cookie for this device

    expect((await user.agent.get("/api/auth/me")).status).toBe(200);
    const revoked = await otherDevice.get("/api/auth/me");
    expect(revoked.status).toBe(401);
    expect(String(revoked.headers["set-cookie"])).toMatch(/session=;/); // stale cookie cleared

    expect((await anonymous().post("/api/auth/login").send({ email: user.email, password: user.password })).status).toBe(401);
    expect((await anonymous().post("/api/auth/login").send({ email: user.email, password: "a-brand-new-one" })).status).toBe(200);
  });

  it("answers a wrong current password with 403 (not 401) and changes nothing", async () => {
    const user = await newUser();
    const res = await user.agent.post("/api/auth/password").send({ currentPassword: "not-it-at-all", newPassword: "a-brand-new-one" });
    expect(res.status).toBe(403);
    expect((await user.agent.get("/api/auth/me")).status).toBe(200);
    expect((await anonymous().post("/api/auth/login").send({ email: user.email, password: user.password })).status).toBe(200);
  });

  it("rejects reusing the same password", async () => {
    const user = await newUser();
    const res = await user.agent.post("/api/auth/password").send({ currentPassword: user.password, newPassword: user.password });
    expect(res.status).toBe(400);
  });
});

describe("delete account", () => {
  it("needs the right password (403), and keeps the session on failure", async () => {
    const user = await newUser();
    expect((await user.agent.delete("/api/auth/me").send({ password: "not-it-at-all" })).status).toBe(403);
    expect((await user.agent.get("/api/auth/me")).status).toBe(200);
  });

  it("is refused while the caller is the only owner of a workspace, and deletes nothing", async () => {
    const owner = await newUser("owner");
    const ws = await newWorkspace(owner, "sole-owned");
    const res = await owner.agent.delete("/api/auth/me").send({ password: owner.password });
    expect(res.status).toBe(409);
    expect(res.body.workspaces).toEqual([{ id: ws.id, name: "Workspace sole-owned", slug: "sole-owned" }]);
    expect((await owner.agent.get("/api/auth/me")).status).toBe(200);
  });

  it("succeeds once another owner exists; brew logs are kept with brewer null", async () => {
    const owner = await newUser("owner");
    const leaver = await newUser("leaver");
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, leaver, "owner"); // two owners, so the leaver isn't the only one
    const bean = await newBean(owner, ws.id);
    const logId = await newBrewLog(leaver, ws.id, bean, { tastingNotes: "by the leaver" });

    const res = await leaver.agent.delete("/api/auth/me").send({ password: leaver.password });
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toMatch(/session=;/);
    expect((await leaver.agent.get("/api/auth/me")).status).toBe(401);
    expect((await anonymous().post("/api/auth/login").send({ email: leaver.email, password: leaver.password })).status).toBe(401);

    const members = await owner.agent.get(`/api/workspaces/${ws.id}/members`);
    expect(members.body.members.map((m: { email: string }) => m.email)).toEqual([owner.email]);

    const log = await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs/${logId}`);
    expect(log.status).toBe(200);
    expect(log.body.brewLog.userId).toBeNull();
    expect(log.body.brewLog.brewer).toBeNull();
    expect(log.body.brewLog.tastingNotes).toBe("by the leaver");
    const list = await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs`);
    expect(list.body.total).toBe(1); // still listed (left join)
  });
});
