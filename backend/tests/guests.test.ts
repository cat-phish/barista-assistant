import { describe, expect, it } from "vitest";
import { addMember, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

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

  it("usage is zero while unused, and delete removes it", async () => {
    const { owner, base } = await setup();
    const id = (await owner.agent.post(base).send({ name: "Sam" })).body.guest.id as string;
    expect((await owner.agent.get(`${base}/${id}/usage`)).body).toEqual({ brewLogCount: 0, servingCount: 0 });
    expect((await owner.agent.delete(`${base}/${id}`)).status).toBe(204);
    expect((await owner.agent.delete(`${base}/${id}`)).status).toBe(404);
    expect((await owner.agent.get(`${base}/${id}/usage`)).status).toBe(404);
  });
});

describe("brews made for guests (docs/api/brew-logs.md §6, \"Who it's for\")", () => {
  it("names who a brew was for, replaces the list, and needs someone", async () => {
    const { owner, ws, base } = await setup();
    const sam = (await owner.agent.post(base).send({ name: "Sam" })).body.guest.id as string;
    const ana = (await owner.agent.post(base).send({ name: "Ana" })).body.guest.id as string;
    const bean = await newBean(owner, ws.id);
    const logs = `/api/workspaces/${ws.id}/brew-logs`;

    const plain = await newBrewLog(owner, ws.id, bean);
    const mine = (await owner.agent.get(`${logs}/${plain}`)).body.brewLog;
    expect(mine).toMatchObject({ forMe: true, guests: [], unnamedGuests: 0 });

    const id = await newBrewLog(owner, ws.id, bean, { forMe: false, guestIds: [sam, ana], unnamedGuests: 2 });
    const log = (await owner.agent.get(`${logs}/${id}`)).body.brewLog;
    expect(log).toMatchObject({ forMe: false, unnamedGuests: 2, guests: [{ id: ana, name: "Ana" }, { id: sam, name: "Sam" }] });
    expect((await owner.agent.get(`${base}/${sam}/usage`)).body).toEqual({ brewLogCount: 1, servingCount: 0 });

    // For nobody: refused on create, and on a change that would leave nobody.
    const bad = { beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, forMe: false };
    expect((await owner.agent.post(logs).send(bad)).status).toBe(400);
    expect((await owner.agent.patch(`${logs}/${id}`).send({ guestIds: [], unnamedGuests: 0 })).status).toBe(400);
    expect((await owner.agent.patch(`${logs}/${plain}`).send({ forMe: false })).status).toBe(400);
    const patched = await owner.agent.patch(`${logs}/${id}`).send({ guestIds: [sam] });
    expect(patched.status).toBe(200);
    expect(patched.body.brewLog.guests).toEqual([{ id: sam, name: "Sam" }]);
    expect((await owner.agent.patch(`${logs}/${id}`).send({ guestIds: [sam, sam] })).status).toBe(400);
    expect((await owner.agent.patch(`${logs}/${id}`).send({ unnamedGuests: 51 })).status).toBe(400);

    // An archived guest is accepted; another workspace's isn't.
    await owner.agent.patch(`${base}/${ana}`).send({ archived: true });
    expect((await owner.agent.patch(`${logs}/${id}`).send({ guestIds: [sam, ana] })).status).toBe(200);
    const other = await newWorkspace(owner);
    const theirs = (await owner.agent.post(`/api/workspaces/${other.id}/guests`).send({ name: "Lee" })).body.guest.id as string;
    expect((await owner.agent.patch(`${logs}/${id}`).send({ guestIds: [theirs] })).status).toBe(400);
  });

  it("deleting a guest keeps them as an unnamed one, so the split stays", async () => {
    const { owner, ws, base } = await setup();
    const sam = (await owner.agent.post(base).send({ name: "Sam" })).body.guest.id as string;
    const bean = await newBean(owner, ws.id);
    const id = await newBrewLog(owner, ws.id, bean, { forMe: false, guestIds: [sam], unnamedGuests: 1 });
    const other = await newBrewLog(owner, ws.id, bean);
    expect((await owner.agent.delete(`${base}/${sam}`)).status).toBe(204);
    const logs = `/api/workspaces/${ws.id}/brew-logs`;
    expect((await owner.agent.get(`${logs}/${id}`)).body.brewLog).toMatchObject({ forMe: false, guests: [], unnamedGuests: 2 });
    expect((await owner.agent.get(`${logs}/${other}`)).body.brewLog.unnamedGuests).toBe(0);
  });
});
