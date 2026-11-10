import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addMember, brewerId, newBean, newBrewLog, newUser, newWorkspace, styleId } from "./helpers.js";

// docs/api/brew-servings.md §6c
describe("brew servings", () => {
  async function setup() {
    const owner = await newUser("owner");
    const barista = await newUser("barista");
    const other = await newUser("barista2");
    const viewer = await newUser("viewer");
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, barista, "barista");
    await addMember(owner, ws.id, other, "barista");
    await addMember(owner, ws.id, viewer, "viewer");
    const base = `/api/workspaces/${ws.id}`;
    const v60 = await brewerId(owner, ws.id, "V60");
    const recipe = async (name: string, style: string) => {
      const id = await styleId(owner, ws.id, "filter", style);
      return (await owner.agent.post(`${base}/recipes`).send({ name, brewerId: v60, styleId: id, targetDoseGrams: 40, targetWaterGrams: 400 })).body.recipe.id as string;
    };
    const [cold, pourOver] = [await recipe("Fridge", "cold_brew"), await recipe("Daily", "pour_over")];
    const bean = await newBean(owner, ws.id);
    const batch = await newBrewLog(owner, ws.id, bean, { recipeId: cold, actualDoseGrams: 40, actualWaterGrams: 400, actualYieldGrams: 310 });
    const url = `${base}/brew-logs/${batch}/servings`;
    return { owner, barista, other, viewer, ws, base, bean, cold, pourOver, batch, url };
  }

  it("logs, lists (oldest first), edits and deletes servings, working out the ratio", async () => {
    const { owner, url, base, batch } = await setup();
    const first = await owner.agent.post(url).send({ concentrateGrams: 120, diluentGrams: 120, timestamp: "2026-11-01T10:00:00.000Z", rating: 4, tastingNotes: " Rich ", flavors: ["sweet"] });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.serving).toMatchObject({
      concentrateGrams: 120,
      diluentGrams: 120,
      dilutedWith: "water",
      dilutionRatio: 1,
      rating: 4,
      tastingNotes: "Rich",
      flavors: [{ key: "sweet", label: expect.any(String) }],
      loggedBy: { id: owner.id, email: owner.email },
    });
    const neat = await owner.agent.post(url).send({ concentrateGrams: 80, diluentGrams: 0, dilutedWith: "milk", timestamp: "2026-10-31T10:00:00.000Z" });
    expect(neat.body.serving).toMatchObject({ diluentGrams: 0, dilutedWith: null, dilutionRatio: null, rating: null, flavors: [] });

    const list = (await owner.agent.get(url)).body.servings as Array<{ id: string }>;
    expect(list.map((s) => s.id)).toEqual([neat.body.serving.id, first.body.serving.id]);
    const log = (await owner.agent.get(`${base}/brew-logs/${batch}`)).body.brewLog;
    expect(log).toMatchObject({ servingCount: 2, pouredGrams: 200, batchFinishedAt: null });

    const edited = await owner.agent.patch(`${url}/${first.body.serving.id}`).send({ diluentGrams: 180, dilutedWith: "milk", flavors: [] });
    expect(edited.body.serving).toMatchObject({ diluentGrams: 180, dilutedWith: "milk", dilutionRatio: 1.5, flavors: [] });
    expect((await owner.agent.patch(`${url}/${first.body.serving.id}`).send({})).status).toBe(400);
    expect((await owner.agent.delete(`${url}/${neat.body.serving.id}`)).status).toBe(204);
    expect((await owner.agent.get(url)).body.servings).toHaveLength(1);
  });

  it("only pours from a finished long batch that's still open", async () => {
    const { owner, base, bean, cold, pourOver, url, batch } = await setup();
    const daily = await newBrewLog(owner, base.split("/")[3]!, bean, { recipeId: pourOver });
    expect((await owner.agent.post(`${base}/brew-logs/${daily}/servings`).send({ concentrateGrams: 50 })).status).toBe(409);
    expect((await owner.agent.put(`${base}/brew-logs/${daily}/batch`).send({ finished: true })).status).toBe(409);
    const steeping = await newBrewLog(owner, base.split("/")[3]!, bean, { recipeId: cold, actualDoseGrams: 40, actualWaterGrams: 400, actualTimeSec: 0, steeping: true });
    expect((await owner.agent.post(`${base}/brew-logs/${steeping}/servings`).send({ concentrateGrams: 50 })).status).toBe(409);

    const done = await owner.agent.put(`${base}/brew-logs/${batch}/batch`).send({ finished: true });
    expect(done.status).toBe(200);
    expect(done.body.brewLog.batchFinishedAt).toEqual(expect.any(String));
    expect((await owner.agent.post(url).send({ concentrateGrams: 50 })).status).toBe(409);
    const reopened = await owner.agent.put(`${base}/brew-logs/${batch}/batch`).send({ finished: false });
    expect(reopened.body.brewLog.batchFinishedAt).toBeNull();
    expect((await owner.agent.post(url).send({ concentrateGrams: 50 })).status).toBe(201);
  });

  it("any barista pours and finishes; a serving is changed by its logger or an owner; viewers read", async () => {
    const { owner, barista, other, viewer, base, batch, url } = await setup();
    const mine = (await barista.agent.post(url).send({ concentrateGrams: 100 })).body.serving.id as string;
    expect((await other.agent.patch(`${url}/${mine}`).send({ rating: 2 })).status).toBe(403);
    expect((await other.agent.delete(`${url}/${mine}`)).status).toBe(403);
    expect((await barista.agent.patch(`${url}/${mine}`).send({ rating: 3 })).status).toBe(200);
    expect((await owner.agent.patch(`${url}/${mine}`).send({ rating: 5 })).body.serving.rating).toBe(5);
    expect((await viewer.agent.get(url)).status).toBe(200);
    expect((await viewer.agent.post(url).send({ concentrateGrams: 100 })).status).toBe(403);
    expect((await viewer.agent.put(`${base}/brew-logs/${batch}/batch`).send({ finished: true })).status).toBe(403);
    expect((await barista.agent.put(`${base}/brew-logs/${batch}/batch`).send({ finished: true })).status).toBe(200);
    // Not in another workspace.
    const outsider = await newUser("outsider");
    expect((await outsider.agent.get(url)).status).toBe(404);
    expect((await owner.agent.get(`${base}/brew-logs/${randomUUID()}/servings`)).status).toBe(404);
    expect((await owner.agent.patch(`${url}/${randomUUID()}`).send({ rating: 2 })).status).toBe(404);
  });

  it("checks the body and flavors", async () => {
    const { owner, url } = await setup();
    for (const body of [{}, { concentrateGrams: 0 }, { concentrateGrams: 100, diluentGrams: -1 }, { concentrateGrams: 100, rating: 4.2 }, { concentrateGrams: 100, dilutedWith: "coke" }, { concentrateGrams: 100, extra: 1 }]) {
      expect((await owner.agent.post(url).send(body)).status, JSON.stringify(body)).toBe(400);
    }
    const res = await owner.agent.post(url).send({ concentrateGrams: 100, flavors: ["not.on.wheel"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/flavor wheel/);
  });

  it("goes with the brew when it's deleted, and in and out of a backup", async () => {
    const { owner, base, batch, url } = await setup();
    await owner.agent.post(url).send({ concentrateGrams: 100, diluentGrams: 50, rating: 4, flavors: ["sweet"] });
    const backup = (await owner.agent.get(`${base}/backup`)).body;
    expect(backup.tables.brew_servings).toEqual([expect.objectContaining({ concentrateGrams: 100, brewedBy: owner.email })]);
    expect(backup.tables.brew_serving_flavors).toHaveLength(1);
    expect(backup.tables.brew_servings[0]).not.toHaveProperty("userId");

    // A file from before servings restores as is.
    const { brew_servings: _s, brew_serving_flavors: _f, ...tables } = backup.tables;
    const old = { ...backup, tables: { ...tables, brew_logs: tables.brew_logs.map(({ batchFinishedAt: _b, ...r }: Record<string, unknown>) => r) } };
    const restored = await owner.agent.post("/api/workspaces/restore").send({ name: "Old", slug: `old-${randomUUID().slice(0, 8)}`, backup: old });
    expect(restored.status, JSON.stringify(restored.body)).toBe(201);
    const logs = (await owner.agent.get(`/api/workspaces/${restored.body.workspaceId}/brew-logs`)).body.brewLogs;
    expect(logs[0]).toMatchObject({ servingCount: 0, batchFinishedAt: null });

    expect((await owner.agent.delete(`${base}/brew-logs/${batch}`)).status).toBe(204);
    expect((await owner.agent.get(url)).status).toBe(404);
    expect((await owner.agent.get(`${base}/backup`)).body.tables.brew_servings).toEqual([]);
  });
});
