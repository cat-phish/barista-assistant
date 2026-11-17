import { describe, expect, it } from "vitest";
import { addMember, newUser, newWorkspace } from "./helpers.js";

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/guests`;
  return { owner, ws, base };
}

describe("guests (docs/api/guests.md §2d)", () => {
  it("adds, changes, archives and lists them by name", async () => {
    const { owner, base } = await setup();
    const created = await owner.agent.post(base).send({ name: " Sam ", notes: " oat milk " });
    expect(created.status).toBe(201);
    expect(created.body.guest).toMatchObject({ name: "Sam", notes: "oat milk", archivedAt: null });
    expect((await owner.agent.post(base).send({ name: "sam" })).status).toBe(409);
    expect((await owner.agent.post(base).send({ name: "" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "Ana", linkedUserId: owner.id })).status).toBe(400); // linking waits for invites

    const id = created.body.guest.id as string;
    expect((await owner.agent.patch(`${base}/${id}`).send({ notes: "" })).body.guest.notes).toBeNull();
    expect((await owner.agent.patch(`${base}/${id}`).send({})).status).toBe(400);
    await owner.agent.post(base).send({ name: "Ana" });
    const archived = (await owner.agent.patch(`${base}/${id}`).send({ archived: true })).body.guest;
    expect(archived.archivedAt).not.toBeNull();
    const { guests } = (await owner.agent.get(base)).body as { guests: Array<{ name: string }> };
    expect(guests.map((g) => g.name)).toEqual(["Ana", "Sam"]); // active first
    expect((await owner.agent.patch(`${base}/${id}`).send({ archived: false })).body.guest.archivedAt).toBeNull();
  });

  it("viewers read only; other workspaces can't see or touch them", async () => {
    const { owner, ws, base } = await setup();
    const id = (await owner.agent.post(base).send({ name: "Sam" })).body.guest.id as string;
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ name: "Ana" })).status).toBe(403);
    expect((await viewer.agent.patch(`${base}/${id}`).send({ name: "Ana" })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/${id}`)).status).toBe(403);

    const stranger = await newUser();
    expect((await stranger.agent.get(base)).status).toBe(404);
    const theirs = await newWorkspace(stranger);
    expect((await stranger.agent.patch(`/api/workspaces/${theirs.id}/guests/${id}`).send({ name: "X" })).status).toBe(404);
    expect((await stranger.agent.delete(`/api/workspaces/${theirs.id}/guests/${id}`)).status).toBe(404);
  });

  it("usage is empty for now, and delete removes it", async () => {
    const { owner, base } = await setup();
    const id = (await owner.agent.post(base).send({ name: "Sam" })).body.guest.id as string;
    expect((await owner.agent.get(`${base}/${id}/usage`)).body).toEqual({});
    expect((await owner.agent.delete(`${base}/${id}`)).status).toBe(204);
    expect((await owner.agent.delete(`${base}/${id}`)).status).toBe(404);
    expect((await owner.agent.get(`${base}/${id}/usage`)).status).toBe(404);
  });
});
