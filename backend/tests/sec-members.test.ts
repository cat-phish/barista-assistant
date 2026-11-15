// Security audit session 4. SEC-01, SEC-32 (member-add half).
import { expect, it } from "vitest";
import { newUser, newWorkspace } from "./helpers.js";

// SEC-01: an owner can force any registered account into a workspace.
it("SEC-01 adding a registered email doesn't join that person until they accept", async () => {
  const owner = await newUser("owner");
  const victim = await newUser("victim");
  const ws = await newWorkspace(owner);
  await owner.agent.post(`/api/workspaces/${ws.id}/members`).send({ email: victim.email, role: "viewer" });
  const list = await victim.agent.get("/api/workspaces");
  const ids = (list.body.workspaces as Array<{ id: string }>).map((w) => w.id);
  expect(ids).not.toContain(ws.id);
});

// SEC-01 / SEC-32: unknown and known emails answer differently.
it("SEC-01 member-add answers an unknown email like a registered one", async () => {
  const owner = await newUser("owner");
  const other = await newUser("other");
  const ws = await newWorkspace(owner);
  const known = await owner.agent.post(`/api/workspaces/${ws.id}/members`).send({ email: other.email, role: "viewer" });
  const unknown = await owner.agent.post(`/api/workspaces/${ws.id}/members`).send({ email: "nobody-here@example.com", role: "viewer" });
  expect(unknown.status).toBe(known.status);
});
