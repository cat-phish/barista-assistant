import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { llmAnalyses } from "@barista/shared/schema";
import { db } from "../src/db.js";
import { addMember, brewerId, newBean, newBrewLog, newUser, newWorkspace, styleId } from "./helpers.js";

// docs/api/brew-logs.md §6, GET list: the Journal's style and status filters.
describe("brew log list filters", () => {
  async function setup() {
    const owner = await newUser("owner");
    const barista = await newUser("barista");
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, barista, "barista");
    const base = `/api/workspaces/${ws.id}`;
    const v60 = await brewerId(owner, ws.id, "V60");
    const [pourOver, coldBrew] = [await styleId(owner, ws.id, "filter", "pour_over"), await styleId(owner, ws.id, "filter", "cold_brew")];
    const recipe = async (name: string, style: string) =>
      (await owner.agent.post(`${base}/recipes`).send({ name, brewerId: v60, styleId: style, targetDoseGrams: 40, targetWaterGrams: 400 })).body.recipe.id as string;
    const [daily, cold] = [await recipe("Daily", pourOver), await recipe("Fridge", coldBrew)];
    const bean = await newBean(owner, ws.id);
    const ids = {
      rated: await newBrewLog(owner, ws.id, bean, { recipeId: daily, rating: 4 }),
      unrated: await newBrewLog(barista, ws.id, bean, { recipeId: daily }),
      coldDone: await newBrewLog(owner, ws.id, bean, { recipeId: cold, actualDoseGrams: 40, actualWaterGrams: 400, rating: 3 }),
      coldSteeping: await newBrewLog(owner, ws.id, bean, { recipeId: cold, actualDoseGrams: 40, actualWaterGrams: 400, actualTimeSec: 0, steeping: true }),
    };
    await db.insert(llmAnalyses).values({ id: randomUUID(), brewLogId: ids.rated, reasoning: "r", suggestedGrindDelta: "finer", suggestedTempDelta: 0 });
    const list = async (query: string) => {
      const res = await owner.agent.get(`${base}/brew-logs?${query}`);
      expect(res.status).toBe(200);
      return (res.body.brewLogs as Array<{ id: string }>).map((l) => l.id).sort();
    };
    return { owner, base, coldBrew, pourOver, ids, list, cold, daily, bean, ws };
  }

  it("filters by the recipe's style", async () => {
    const { coldBrew, pourOver, ids, list } = await setup();
    expect(await list(`styleId=${coldBrew}`)).toEqual([ids.coldDone, ids.coldSteeping].sort());
    expect(await list(`styleId=${pourOver}`)).toEqual([ids.rated, ids.unrated].sort());
  });

  it("filters by status: steeping, not rated, not analyzed (finished brews only)", async () => {
    const { ids, list } = await setup();
    expect(await list("status=steeping")).toEqual([ids.coldSteeping]);
    expect(await list("status=unrated")).toEqual([ids.unrated]);
    expect(await list("status=unanalyzed")).toEqual([ids.unrated, ids.coldDone].sort());
  });

  it("combines with the other filters", async () => {
    const { coldBrew, ids, list } = await setup();
    expect(await list(`styleId=${coldBrew}&status=steeping`)).toEqual([ids.coldSteeping]);
    expect(await list("mine=1&status=unanalyzed")).toEqual([ids.coldDone]);
  });

  it("rejects a bad style id or status", async () => {
    const { owner, base } = await setup();
    expect((await owner.agent.get(`${base}/brew-logs?styleId=nope`)).status).toBe(400);
    expect((await owner.agent.get(`${base}/brew-logs?status=done`)).status).toBe(400);
  });

  it("keeps the style a brew was brewed as when its recipe is restyled or deleted", async () => {
    const { owner, base, coldBrew, pourOver, ids, list, cold, daily } = await setup();
    expect((await owner.agent.patch(`${base}/recipes/${cold}`).send({ styleId: pourOver })).status).toBe(200);
    expect(await list(`styleId=${coldBrew}`)).toEqual([ids.coldDone, ids.coldSteeping].sort());
    const log = (await owner.agent.get(`${base}/brew-logs/${ids.coldDone}`)).body.brewLog;
    expect(log.style).toMatchObject({ id: coldBrew, brewsLike: "cold_brew" });
    expect((await owner.agent.delete(`${base}/recipes/${cold}`)).status).toBe(204);
    expect(await list(`styleId=${coldBrew}`)).toEqual([ids.coldDone, ids.coldSteeping].sort());
    // Moved to another recipe, a brew takes that recipe's style.
    expect((await owner.agent.patch(`${base}/brew-logs/${ids.coldDone}`).send({ recipeId: daily })).status).toBe(200);
    expect(await list(`styleId=${coldBrew}`)).toEqual([ids.coldSteeping]);
    expect(await list(`styleId=${pourOver}`)).toContain(ids.coldDone);
  });
});
