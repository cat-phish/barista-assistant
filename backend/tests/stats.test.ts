import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as schema from "@barista/shared/schema";
import { db } from "../src/db.js";
import { addMember, brewerId, newBean, newBrewLog, newUser, newWorkspace, styleId } from "./helpers.js";

describe("stats (docs/api/stats.md §11)", () => {
  it("sends compact brew rows with ids, the method and style, tools and problems", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const base = `/api/workspaces/${ws.id}`;
    const c40 = (await owner.agent.post(`${base}/grinders`).send({ name: "C40" })).body.grinder.id as string;
    const [v60, pourOver] = [await brewerId(owner, ws.id, "V60"), await styleId(owner, ws.id, "filter", "pour_over")];
    const recipe = (await owner.agent.post(`${base}/recipes`).send({ name: "House V60", brewerId: v60, styleId: pourOver, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
    const tools = (await owner.agent.get(`${base}/prep-tools`)).body.tools as Array<{ id: string; name: string }>;
    const problems = (await owner.agent.get(`${base}/brew-problems`)).body.problems as Array<{ id: string; name: string }>;
    const rdt = tools.find((t) => t.name === "RDT")!.id;
    const fast = problems.find((p) => p.name === "Fast drawdown")!.id;
    const bean = await newBean(owner, ws.id);
    const log = await newBrewLog(owner, ws.id, bean, {
      recipeId: recipe,
      grinderId: c40,
      actualGrindSetting: 21,
      actualYieldGrams: 220,
      tdsPercent: 1.38,
      toolIds: [rdt],
      problemIds: [fast],
      rating: 4,
      tastingNotes: "Sweet",
    });

    const res = await owner.agent.get(`${base}/stats`);
    expect(res.status).toBe(200);
    const method = (res.body.lookups.brewers as Array<{ id: string; methodId: string }>).find((b) => b.id === v60)!.methodId;
    expect(res.body.brews).toEqual([
      expect.objectContaining({
        id: log,
        userId: owner.id,
        beanId: bean,
        recipeId: recipe,
        brewerId: v60,
        methodId: method,
        styleId: pourOver,
        brewsLike: "pour_over",
        grinderId: c40,
        toolIds: [rdt],
        problemIds: [fast],
        doseGrams: 15,
        waterGrams: 250,
        yieldGrams: 220,
        grindSetting: 21,
        tdsPercent: 1.38,
        rating: 4,
      }),
    ]);
    expect(res.body.brews[0]).not.toHaveProperty("tastingNotes");
    expect(res.body.lookups.recipes).toEqual([{ id: recipe, name: "House V60" }]);
    expect(res.body.lookups.methods).toContainEqual({ id: method, name: expect.any(String) });
    expect(res.body.lookups.tools).toContainEqual({ id: rdt, name: "RDT" });
    expect(res.body.lookups.problems).toContainEqual({ id: fast, name: "Fast drawdown" });
  });

  it("filters by local date, bean, recipe, brewer and mine; leaves steeping brews out", async () => {
    const owner = await newUser("owner");
    const barista = await newUser("barista");
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, barista, "barista");
    const base = `/api/workspaces/${ws.id}`;
    const v60 = await brewerId(owner, ws.id, "V60");
    const recipe = (await owner.agent.post(`${base}/recipes`).send({ name: "R", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
    const [a, b] = [await newBean(owner, ws.id), await newBean(owner, ws.id, { beanName: "Other" })];
    // 03:30 UTC on the 21st is still the 20th in PDT.
    const late = await newBrewLog(owner, ws.id, a, { timestamp: "2026-10-21T03:30:00.000Z", utcOffsetMinutes: -420, recipeId: recipe });
    const next = await newBrewLog(barista, ws.id, b, { timestamp: "2026-10-21T15:00:00.000Z", utcOffsetMinutes: -420 });
    await newBrewLog(owner, ws.id, a, { timestamp: "2026-10-21T16:00:00.000Z", steeping: true, actualTimeSec: 0 });

    const ids = async (q: string) => ((await owner.agent.get(`${base}/stats?${q}`)).body.brews as Array<{ id: string }>).map((r) => r.id);
    expect(await ids("")).toEqual([late, next]);
    expect(await ids("from=2026-10-20&to=2026-10-20")).toEqual([late]);
    expect(await ids("from=2026-10-21")).toEqual([next]);
    expect(await ids(`beanId=${b}`)).toEqual([next]);
    expect(await ids(`recipeId=${recipe}`)).toEqual([late]);
    expect(await ids(`brewerId=${v60}`)).toEqual([late]);
    expect(await ids("mine=1")).toEqual([late]);

    expect((await owner.agent.get(`${base}/stats?from=2026-10-22&to=2026-10-21`)).status).toBe(400);
    expect((await owner.agent.get(`${base}/stats?from=yesterday`)).status).toBe(400);
    expect((await owner.agent.get(`${base}/stats?beanId=nope`)).status).toBe(400);
  });

  it("sends every bean with its freezes, photo count, price and stock, whatever the filters", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const base = `/api/workspaces/${ws.id}`;
    const bean = await newBean(owner, ws.id, { country: "Colombia, Ethiopia", priceAmount: 22.5, priceCurrency: "USD", bagWeightGrams: 340, inventoryWeightGrams: 120, purchaseDate: "2026-10-03" });
    const other = await newBean(owner, ws.id, { beanName: "Unbrewed" });
    expect((await owner.agent.post(`${base}/beans/${bean}/freeze`).send({ date: "2026-10-05" })).status).toBe(200);
    await db.insert(schema.beanPhotos).values([0, 1].map((position) => ({ id: randomUUID(), beanId: bean, position, width: 10, height: 10 })));
    await owner.agent.patch(`${base}/beans/${other}`).send({ archived: true });

    const res = await owner.agent.get(`${base}/stats?beanId=${other}&from=2026-01-01`);
    expect(res.body.brews).toEqual([]);
    // Added in the same second, so in either order.
    expect(res.body.beans).toHaveLength(2);
    expect(res.body.beans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: bean,
        country: "Colombia, Ethiopia",
        priceAmount: 22.5,
        priceCurrency: "USD",
        bagWeightGrams: 340,
        inventoryWeightGrams: 120,
        purchaseDate: "2026-10-03",
        archivedAt: null,
        freezes: [{ frozenOn: "2026-10-05", thawedOn: null }],
        photoCount: 2,
      }),
      expect.objectContaining({ id: other, freezes: [], photoCount: 0, archivedAt: expect.any(String) }),
    ]));
  });

  it("any member can read, viewers included; others get 404 and see nothing", async () => {
    const owner = await newUser("owner");
    const viewer = await newUser("viewer");
    const stranger = await newUser("stranger");
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, viewer, "viewer");
    await newBrewLog(owner, ws.id, await newBean(owner, ws.id));

    const url = `/api/workspaces/${ws.id}/stats`;
    const seen = await viewer.agent.get(url);
    expect(seen.status).toBe(200);
    expect(seen.body.brews).toHaveLength(1);
    expect((await stranger.agent.get(url)).status).toBe(404);

    // A brew in the stranger's own workspace doesn't show up in the other one.
    const theirs = await newWorkspace(stranger);
    await newBrewLog(stranger, theirs.id, await newBean(stranger, theirs.id));
    expect((await owner.agent.get(url)).body.brews).toHaveLength(1);
  });
});
