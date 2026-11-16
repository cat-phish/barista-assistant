// ALLOW_REGISTRATION=invite: sign-up only for an email with a pending invite (docs/api/auth.md §1).
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { newUser, newWorkspace } from "./helpers.js";

afterEach(() => vi.unstubAllEnvs());
const PASSWORD = "correct-horse-battery";

describe("invite-only registration", () => {
  it("reports itself, refuses a stranger and takes an invited email", async () => {
    const owner = await newUser(); // before the switch: helpers sign up
    const ws = await newWorkspace(owner);
    vi.stubEnv("ALLOW_REGISTRATION", "invite");
    const status = (await request(app).get("/api/auth/registration")).body;
    expect(status).toMatchObject({ open: true, inviteOnly: true });
    expect((await request(app).post("/api/auth/register").send({ email: "stranger@example.com", password: PASSWORD })).status).toBe(403);

    const email = `Invited-${crypto.randomUUID().slice(0, 8)}@example.com`;
    expect((await owner.agent.post(`/api/workspaces/${ws.id}/members`).send({ email, role: "viewer" })).status).toBeLessThan(300);
    const reg = await request(app).post("/api/auth/register").send({ email, password: PASSWORD });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  });
  it("is open by default and closed by false", async () => {
    expect((await request(app).get("/api/auth/registration")).body).toMatchObject({ open: true, inviteOnly: false });
    vi.stubEnv("ALLOW_REGISTRATION", "false");
    expect((await request(app).get("/api/auth/registration")).body).toMatchObject({ open: false, inviteOnly: false });
  });
});
