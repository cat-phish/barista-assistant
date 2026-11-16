// Email verification (docs/api/auth.md §1e). Off by default.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { setMailSender, type Mail } from "../src/mail.js";
import { anonymous, newUser, newWorkspace } from "./helpers.js";

let sent: Mail[] = [];
beforeEach(() => {
  sent = [];
  setMailSender(async (m) => {
    sent.push(m);
  });
});
afterEach(() => {
  setMailSender(null);
  vi.unstubAllEnvs();
});
const on = () => {
  vi.stubEnv("EMAIL_VERIFICATION", "true");
  vi.stubEnv("APP_URL", "https://coffee.example");
};
const tokenOf = (m: Mail): string => /#([A-Za-z0-9_-]+)/.exec(m.text)![1]!;
const PASSWORD = "correct-horse-battery";
// With verification on, sign-up answers 202 and starts no session: sign in after.
async function signUp(agent: ReturnType<typeof anonymous>, email: string) {
  const reg = await agent.post("/api/auth/register").send({ email, password: PASSWORD });
  expect(reg.status).toBe(202);
  expect((await agent.post("/api/auth/login").send({ email, password: PASSWORD })).status).toBe(200);
}

describe("email verification", () => {
  it("is off by default: no mail, invites accepted as before, endpoints 404", async () => {
    const agent = anonymous();
    expect((await agent.post("/api/auth/register").send({ email: "off@example.com", password: PASSWORD })).status).toBe(201);
    expect(sent).toHaveLength(0);
    expect((await agent.post("/api/auth/verify-email/send")).status).toBe(404);
    expect((await request(app).post("/api/auth/verify-email").send({ token: "x".repeat(43) })).status).toBe(404);
    expect((await request(app).get("/api/auth/registration")).body.emailVerification).toBe(false);
  });

  it("mails a link on sign-up built from APP_URL, and the link verifies once", async () => {
    on();
    const agent = anonymous();
    await signUp(agent, "new@example.com");
    expect((await agent.get("/api/auth/me")).body.user.emailVerified).toBe(false);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.to).toBe("new@example.com");
    expect(sent[0]!.text).toContain("https://coffee.example/verify-email#");
    const token = tokenOf(sent[0]!);
    expect((await request(app).post("/api/auth/verify-email").send({ token })).status).toBe(204);
    expect((await agent.get("/api/auth/me")).body.user.emailVerified).toBe(true);
    expect((await request(app).post("/api/auth/verify-email").send({ token })).status).toBe(400); // single use
  });

  it("refuses unknown tokens and replaced ones", async () => {
    on();
    const agent = anonymous();
    await signUp(agent, "twice@example.com");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const first = tokenOf(sent[0]!);
    expect((await agent.post("/api/auth/verify-email/send")).status).toBe(204);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect((await request(app).post("/api/auth/verify-email").send({ token: "A".repeat(43) })).status).toBe(400);
    expect((await request(app).post("/api/auth/verify-email").send({ token: first })).status).toBe(400); // replaced
    expect((await request(app).post("/api/auth/verify-email").send({ token: tokenOf(sent[1]!) })).status).toBe(204);
  });

  it("an unverified address can't accept an invite; a verified one can", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    on();
    const agent = anonymous();
    const email = "claimer@example.com";
    await owner.agent.post(`/api/workspaces/${ws.id}/members`).send({ email, role: "viewer" });
    await signUp(agent, email);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const id = (await agent.get("/api/invites")).body.invites[0].id as string;
    const early = await agent.post(`/api/invites/${id}/accept`);
    expect(early.status).toBe(403);
    await request(app).post("/api/auth/verify-email").send({ token: tokenOf(sent[0]!) });
    expect((await agent.post(`/api/invites/${id}/accept`)).status).toBe(200);
  });

  // SEC-32: with verification on, a taken address gets the same reply as a new one.
  it("answers a taken address like a new one, and mails its owner instead", async () => {
    on();
    await signUp(anonymous(), "taken@example.com");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const again = await anonymous().post("/api/auth/register").send({ email: "taken@example.com", password: "another-long-password" });
    expect(again.status).toBe(202);
    expect(again.headers["set-cookie"]).toBeUndefined();
    expect(again.body).toEqual({ pending: true });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.to).toBe("taken@example.com");
    expect(sent[1]!.subject).toMatch(/tried to sign up/);
  });

  it("without verification a taken address is still a 409", async () => {
    await anonymous().post("/api/auth/register").send({ email: "plain@example.com", password: PASSWORD });
    expect((await anonymous().post("/api/auth/register").send({ email: "plain@example.com", password: PASSWORD })).status).toBe(409);
  });
});
