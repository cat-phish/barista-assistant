import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { addMember, brewerId, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

describe("workspaces", () => {
  it("creating one makes the caller owner and seeds the default brew methods", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const list = await owner.agent.get("/api/workspaces");
    expect(list.body.workspaces).toMatchObject([{ id: ws.id, role: "owner", isPublicMenuEnabled: false }]);
    const methods = await owner.agent.get(`/api/workspaces/${ws.id}/brewers`);
    expect(methods.body.brewers.map((m: { name: string }) => m.name)).toEqual(["Aeropress", "Espresso", "V60"]);
  });

  it("rejects duplicate and malformed slugs", async () => {
    const owner = await newUser();
    await newWorkspace(owner, "taken-slug");
    expect((await owner.agent.post("/api/workspaces").send({ name: "x", slug: "taken-slug" })).status).toBe(409);
    expect((await owner.agent.post("/api/workspaces").send({ name: "x", slug: "Not A Slug" })).status).toBe(400);
  });

  it("only owners can change settings", async () => {
    const owner = await newUser();
    const barista = await newUser();
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, barista, "barista");
    expect((await barista.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true })).status).toBe(403);
    const ok = await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    expect(ok.body.workspace.isPublicMenuEnabled).toBe(true);
  });
});

describe("changing the web address (slug)", () => {
  it("moves the public menu to the new address", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner, "old-address");
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    const res = await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ slug: "new-address" });
    expect(res.status).toBe(200);
    expect(res.body.workspace.slug).toBe("new-address");
    expect((await request(app).get("/api/public/menu/new-address")).status).toBe(200);
    expect((await request(app).get("/api/public/menu/old-address")).status).toBe(404);
  });

  it("rejects taken and malformed slugs, and non-owners", async () => {
    const owner = await newUser();
    const barista = await newUser();
    await newWorkspace(owner, "someone-else");
    const ws = await newWorkspace(owner, "mine-to-move");
    await addMember(owner, ws.id, barista, "barista");
    expect((await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ slug: "someone-else" })).status).toBe(409);
    expect((await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ slug: "No Spaces" })).status).toBe(400);
    expect((await barista.agent.patch(`/api/workspaces/${ws.id}`).send({ slug: "barista-move" })).status).toBe(403);
    // Saving the current slug unchanged is fine.
    expect((await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ slug: "mine-to-move" })).status).toBe(200);
  });
});

describe("deleting a workspace", () => {
  it("needs ?confirm=<slug> and an owner", async () => {
    const owner = await newUser();
    const barista = await newUser();
    const ws = await newWorkspace(owner, "keep-me");
    await addMember(owner, ws.id, barista, "barista");
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}`)).status).toBe(400);
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}?confirm=KEEP-ME`)).status).toBe(400);
    expect((await barista.agent.delete(`/api/workspaces/${ws.id}?confirm=keep-me`)).status).toBe(403);
    expect((await owner.agent.get("/api/workspaces")).body.workspaces).toHaveLength(1);
  });

  it("deletes everything in it, including recipes (the old restrict-FK bug)", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner, "doomed");
    const bean = await newBean(owner, ws.id);
    const v60 = await brewerId(owner, ws.id, "V60"); // resolve before starting the next request
    const recipe = await owner.agent.post(`/api/workspaces/${ws.id}/recipes`).send({
      name: "House V60",
      brewerId: v60,
      targetDoseGrams: 15,
      targetWaterGrams: 250,
      steps: [{ stepType: "bloom", durationSec: 45, targetWaterGrams: 50 }],
    });
    expect(recipe.status).toBe(201);
    await newBrewLog(owner, ws.id, bean, { recipeId: recipe.body.recipe.id });

    expect((await owner.agent.delete(`/api/workspaces/${ws.id}?confirm=doomed`)).status).toBe(204);
    expect((await owner.agent.get("/api/workspaces")).body.workspaces).toEqual([]);
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/beans`)).status).toBe(404);
    // The slug is free again.
    expect((await owner.agent.post("/api/workspaces").send({ name: "Again", slug: "doomed" })).status).toBe(201);
  });
});

describe("members and roles", () => {
  it("a workspace can't lose its last owner (demote or remove)", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    expect((await owner.agent.patch(`/api/workspaces/${ws.id}/members/${owner.id}`).send({ role: "barista" })).status).toBe(409);
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}/members/${owner.id}`)).status).toBe(409);
  });

  it("only owners invite or change roles; anyone can leave", async () => {
    const owner = await newUser();
    const barista = await newUser();
    const viewer = await newUser();
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, barista, "barista");
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await barista.agent.post(`/api/workspaces/${ws.id}/members`).send({ email: "x@example.com", role: "viewer" })).status).toBe(403);
    expect((await barista.agent.delete(`/api/workspaces/${ws.id}/members/${viewer.id}`)).status).toBe(403);
    expect((await viewer.agent.delete(`/api/workspaces/${ws.id}/members/${viewer.id}`)).status).toBe(204);
    expect((await viewer.agent.get(`/api/workspaces/${ws.id}/beans`)).status).toBe(404);
  });
});

describe("permissions", () => {
  it("outsiders get 404 everywhere, never 403, so they can't tell what exists", async () => {
    const owner = await newUser();
    const outsider = await newUser();
    const ws = await newWorkspace(owner);
    const bean = await newBean(owner, ws.id);
    const log = await newBrewLog(owner, ws.id, bean);
    for (const path of [
      `/api/workspaces/${ws.id}/beans`,
      `/api/workspaces/${ws.id}/recipes`,
      `/api/workspaces/${ws.id}/brew-logs/${log}`,
      `/api/workspaces/${ws.id}/members`,
    ]) {
      expect((await outsider.agent.get(path)).status, path).toBe(404);
    }
    expect((await outsider.agent.post(`/api/workspaces/${ws.id}/beans`).send({ roasterName: "a", beanName: "b" })).status).toBe(404);
  });

  it("viewers read but can't write; baristas edit only their own brew logs", async () => {
    const owner = await newUser();
    const barista = await newUser();
    const otherBarista = await newUser();
    const viewer = await newUser();
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, barista, "barista");
    await addMember(owner, ws.id, otherBarista, "barista");
    await addMember(owner, ws.id, viewer, "viewer");
    const bean = await newBean(owner, ws.id);
    const log = await newBrewLog(barista, ws.id, bean);
    const path = `/api/workspaces/${ws.id}/brew-logs/${log}`;

    expect((await viewer.agent.get(path)).status).toBe(200);
    expect((await viewer.agent.post(`/api/workspaces/${ws.id}/beans`).send({ roasterName: "a", beanName: "b" })).status).toBe(403);
    expect((await otherBarista.agent.patch(path).send({ rating: 1 })).status).toBe(403);
    expect((await otherBarista.agent.delete(path)).status).toBe(403);
    expect((await barista.agent.patch(path).send({ rating: 4 })).body.brewLog.rating).toBe(4);
    expect((await owner.agent.patch(path).send({ rating: 5 })).body.brewLog.rating).toBe(5);
  });
});
