// Invites (docs/api/workspaces.md §2 "Invites", SEC-01).
import { describe, expect, it } from "vitest";
import { addMember, anonymous, newUser, newWorkspace } from "./helpers.js";

const members = (wsId: string) => `/api/workspaces/${wsId}/members`;
const invites = (wsId: string) => `/api/workspaces/${wsId}/invites`;

describe("invites", () => {
  it("an invited person is listed, can read nothing, and joins only by accepting", async () => {
    const owner = await newUser("owner");
    const guest = await newUser("guest");
    const ws = await newWorkspace(owner);
    expect((await owner.agent.post(members(ws.id)).send({ email: guest.email, role: "barista" })).status).toBe(202);
    expect((await guest.agent.get(`/api/workspaces/${ws.id}/beans`)).status).toBe(404);

    const mine = (await guest.agent.get("/api/invites")).body.invites as Array<{ id: string; role: string; workspace: { slug: string }; invitedBy: string }>;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ role: "barista", workspace: { slug: ws.slug }, invitedBy: owner.email });
    expect((await owner.agent.get(invites(ws.id))).body.invites).toHaveLength(1);

    expect((await guest.agent.post(`/api/invites/${mine[0]!.id}/accept`)).status).toBe(200);
    expect((await guest.agent.get(`/api/workspaces/${ws.id}/beans`)).status).toBe(200);
    expect((await owner.agent.get(invites(ws.id))).body.invites).toHaveLength(0);
  });

  it("answers the same for an account that exists, one that doesn't, and a member", async () => {
    const owner = await newUser();
    const other = await newUser();
    const ws = await newWorkspace(owner);
    const a = await owner.agent.post(members(ws.id)).send({ email: other.email, role: "viewer" });
    const b = await owner.agent.post(members(ws.id)).send({ email: "nobody-here@example.com", role: "viewer" });
    const c = await owner.agent.post(members(ws.id)).send({ email: owner.email, role: "viewer" });
    expect([a.status, b.status, c.status]).toEqual([202, 202, 202]);
    expect(b.body).toEqual(a.body);
  });

  it("an invite for an email with no account waits for it to register", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const email = "later-joiner@example.com";
    await owner.agent.post(members(ws.id)).send({ email, role: "viewer" });
    const agent = anonymous();
    expect((await agent.post("/api/auth/register").send({ email, password: "correct-horse-battery" })).status).toBe(201);
    expect((await agent.get("/api/invites")).body.invites).toHaveLength(1);
  });

  it("only the invited email can accept or decline; others get 404", async () => {
    const owner = await newUser();
    const guest = await newUser();
    const stranger = await newUser();
    const ws = await newWorkspace(owner);
    await owner.agent.post(members(ws.id)).send({ email: guest.email, role: "owner" });
    const id = (await guest.agent.get("/api/invites")).body.invites[0].id as string;
    expect((await stranger.agent.post(`/api/invites/${id}/accept`)).status).toBe(404);
    expect((await stranger.agent.delete(`/api/invites/${id}`)).status).toBe(404);
    expect((await guest.agent.delete(`/api/invites/${id}`)).status).toBe(204);
    expect((await guest.agent.post(`/api/invites/${id}/accept`)).status).toBe(404);
  });

  it("owners cancel invites; baristas and outsiders can't see or send them", async () => {
    const owner = await newUser();
    const barista = await newUser();
    const outsider = await newUser();
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, barista, "barista");
    await owner.agent.post(members(ws.id)).send({ email: "x@example.com", role: "viewer" });
    const id = (await owner.agent.get(invites(ws.id))).body.invites[0].id as string;
    expect((await barista.agent.get(invites(ws.id))).status).toBe(403);
    expect((await barista.agent.post(members(ws.id)).send({ email: "y@example.com", role: "viewer" })).status).toBe(403);
    expect((await outsider.agent.get(invites(ws.id))).status).toBe(404);
    expect((await owner.agent.delete(`${invites(ws.id)}/${id}`)).status).toBe(204);
    expect((await owner.agent.get(invites(ws.id))).body.invites).toHaveLength(0);
  });

  it("re-inviting changes the role instead of adding a second invite", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    await owner.agent.post(members(ws.id)).send({ email: "z@example.com", role: "viewer" });
    await owner.agent.post(members(ws.id)).send({ email: "Z@example.com", role: "barista" });
    const list = (await owner.agent.get(invites(ws.id))).body.invites as Array<{ role: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.role).toBe("barista");
  });

  it("caps pending invites per workspace at 50", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    let last = 0;
    for (let i = 0; i < 51; i++) last = (await owner.agent.post(members(ws.id)).send({ email: `cap${i}@example.com`, role: "viewer" })).status;
    expect(last).toBe(409);
  });
});
