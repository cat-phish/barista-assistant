import { describe, expect, it } from "vitest";
import request from "supertest";
import { brewAnalysisJobId } from "@barista/shared/jobs";
import { app } from "../src/app.js";
import { brewAnalysisQueue } from "../src/queue.js";
import { addMember, brewerId, menuAdd, menuSection, newBean, newBrewLog, newUser, newWorkspace, type TestUser, processId } from "./helpers.js";

async function setup(): Promise<{ owner: TestUser; ws: { id: string; slug: string }; v60: string }> {
  const owner = await newUser("owner");
  const ws = await newWorkspace(owner);
  return { owner, ws, v60: await brewerId(owner, ws.id, "V60") };
}

describe("brewers", () => {
  it("rename: case-only allowed, duplicates refused, recipes follow the new name", async () => {
    const { owner, ws, v60 } = await setup();
    const base = `/api/workspaces/${ws.id}/brewers`;
    const recipe = await owner.agent.post(`/api/workspaces/${ws.id}/recipes`).send({ name: "R", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 });

    expect((await owner.agent.patch(`${base}/${v60}`).send({ name: "v60" })).status).toBe(200);
    expect((await owner.agent.patch(`${base}/${v60}`).send({ name: "espresso" })).status).toBe(409);
    expect((await owner.agent.patch(`${base}/${v60}`).send({ name: "  Hario V60 " })).body.brewer.name).toBe("Hario V60");

    const recipes = await owner.agent.get(`/api/workspaces/${ws.id}/recipes`);
    expect(recipes.body.recipes[0]).toMatchObject({ id: recipe.body.recipe.id, brewer: { id: v60, name: "Hario V60" } });
  });

  it("usage counts the recipes a delete takes with it; the delete removes them", async () => {
    const { owner, ws, v60 } = await setup();
    const recipes = `/api/workspaces/${ws.id}/recipes`;
    await owner.agent.post(recipes).send({ name: "R", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 });
    const url = `/api/workspaces/${ws.id}/brewers/${v60}`;
    expect((await owner.agent.get(`${url}/usage`)).body).toEqual({ recipeCount: 1, brewLogCount: 0, menuItemCount: 0 });
    expect((await owner.agent.delete(url)).status).toBe(204);
    expect((await owner.agent.get(recipes)).body.recipes).toEqual([]);
    expect((await owner.agent.get(`${url}/usage`)).status).toBe(404);
  });
});

describe("beans and recipes", () => {
  it("decimals are JSON numbers; too many decimal places are rejected, not rounded", async () => {
    const { owner, ws, v60 } = await setup();
    const base = `/api/workspaces/${ws.id}/recipes`;
    const ok = await owner.agent.post(base).send({ name: "R", brewerId: v60, targetDoseGrams: 18.5, targetWaterGrams: 250, targetTempC: 93.5 });
    expect(ok.body.recipe).toMatchObject({ targetDoseGrams: 18.5, targetWaterGrams: 250, targetTempC: 93.5 });
    expect((await owner.agent.post(base).send({ name: "R", brewerId: v60, targetDoseGrams: 15.123, targetWaterGrams: 250 })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "R", brewerId: v60, targetDoseGrams: "15", targetWaterGrams: 250 })).status).toBe(400);
  });

  it("recipe steps are validated, and a brewer from another workspace is refused", async () => {
    const { owner, ws, v60 } = await setup();
    const other = await newUser();
    const otherWs = await newWorkspace(other);
    const foreign = await brewerId(other, otherWs.id, "V60");
    const base = `/api/workspaces/${ws.id}/recipes`;
    const steps = [
      { stepType: "bloom", durationSec: 45, targetWaterGrams: 50 },
      { stepType: "pour", durationSec: 30, targetWaterGrams: 40 }, // pour-to goes down
    ];
    expect((await owner.agent.post(base).send({ name: "R", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250, steps })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "R", brewerId: foreign, targetDoseGrams: 15, targetWaterGrams: 250 })).status).toBe(400);
  });

  it("PATCH changes only the fields sent", async () => {
    const { owner, ws } = await setup();
    const washed = await processId(owner, ws.id, "washed");
    const bean = await newBean(owner, ws.id, { processId: washed, roastDate: "2026-10-01", inventoryWeightGrams: 250 });
    const res = await owner.agent.patch(`/api/workspaces/${ws.id}/beans/${bean}`).send({ beanName: "Renamed" });
    expect(res.body.bean).toMatchObject({ beanName: "Renamed", processId: washed, inventoryWeightGrams: 250, roastDate: "2026-10-01T00:00:00.000Z" });
  });

  it("roast level is optional, limited to ROAST_LEVELS, and can be cleared", async () => {
    const { owner, ws } = await setup();
    const base = `/api/workspaces/${ws.id}/beans`;
    const bean = await newBean(owner, ws.id, { roastLevel: "medium_light" });
    expect((await owner.agent.get(base)).body.beans[0].roastLevel).toBe("medium_light");
    expect((await owner.agent.patch(`${base}/${bean}`).send({ roastLevel: "very dark" })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/${bean}`).send({ roastLevel: null })).body.bean.roastLevel).toBeNull();
    expect((await owner.agent.get(base)).body.beans[0].roastLevel).toBeNull();
    expect((await owner.agent.post(base).send({ roasterName: "A", beanName: "B" })).body.bean.roastLevel).toBeNull();
  });

  it("deleting a bean with brew logs needs ?deleteBrewLogs=true", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    await newBrewLog(owner, ws.id, bean);
    const refused = await owner.agent.delete(`/api/workspaces/${ws.id}/beans/${bean}`);
    expect(refused.status).toBe(409);
    expect(refused.body.brewLogCount).toBe(1);
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}/beans/${bean}?deleteBrewLogs=true`)).status).toBe(204);
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs`)).body.total).toBe(0);
  });
});

describe("brew logs", () => {
  it("rejects timestamps in the future but allows backdating", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const brew = { beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect((await owner.agent.post(base).send({ ...brew, timestamp: future })).status).toBe(400);
    expect((await owner.agent.post(base).send({ ...brew, timestamp: "2026-10-01T08:00:00-07:00" })).body.brewLog.timestamp).toBe("2026-10-01T15:00:00.000Z");
  });

  it("records the device's UTC offset for the local brew date", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const brew = { beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };
    const created = await owner.agent.post(base).send({ ...brew, utcOffsetMinutes: -420 });
    expect(created.body.brewLog.utcOffsetMinutes).toBe(-420);
    expect((await owner.agent.post(base).send(brew)).body.brewLog.utcOffsetMinutes).toBeNull();
    for (const utcOffsetMinutes of [841, -721, 1.5, "60"]) {
      expect((await owner.agent.post(base).send({ ...brew, utcOffsetMinutes })).status, String(utcOffsetMinutes)).toBe(400);
    }
  });

  it("lists newest first with filters and paging", async () => {
    const { owner, ws } = await setup();
    const a = await newBean(owner, ws.id);
    const b = await newBean(owner, ws.id, { beanName: "Other" });
    for (const day of ["01", "03", "02"]) await newBrewLog(owner, ws.id, a, { timestamp: `2026-10-${day}T08:00:00Z` });
    await newBrewLog(owner, ws.id, b, { timestamp: "2026-10-04T08:00:00Z" });
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const forA = await owner.agent.get(`${base}?beanId=${a}`);
    expect(forA.body.total).toBe(3);
    expect(forA.body.brewLogs.map((l: { timestamp: string }) => l.timestamp.slice(8, 10))).toEqual(["03", "02", "01"]);
    const page = await owner.agent.get(`${base}?limit=1&offset=1`);
    expect(page.body).toMatchObject({ total: 4, brewLogs: [{ beanId: a }] });
    expect((await owner.agent.get(`${base}?limit=500`)).status).toBe(400);
  });
});

describe("suggestions and analysis", () => {
  it("suggestions return the analyzed brew even when it's older than the last 5", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const oldest = await newBrewLog(owner, ws.id, bean, { timestamp: "2026-10-01T08:00:00Z", tastingNotes: "oldest" });
    for (let d = 2; d <= 7; d++) await newBrewLog(owner, ws.id, bean, { timestamp: `2026-10-0${d}T08:00:00Z` });

    const empty = await owner.agent.get(`/api/beans/${bean}/suggestions`);
    expect(empty.body).toMatchObject({ latestAnalysis: null, analyzedBrew: null });
    expect(empty.body.recentBrews).toHaveLength(5);

    const { db } = await import("../src/db.js");
    const { llmAnalyses } = await import("@barista/shared/schema");
    await db.insert(llmAnalyses).values({ id: crypto.randomUUID(), brewLogId: oldest, reasoning: "r", suggestedGrindDelta: "finer", suggestedTempDelta: 1.5 });

    const res = await owner.agent.get(`/api/beans/${bean}/suggestions`);
    expect(res.body.latestAnalysis).toMatchObject({ brewLogId: oldest, suggestedTempDelta: 1.5 });
    expect(res.body.analyzedBrew).toMatchObject({ id: oldest, tastingNotes: "oldest" });
  });

  it("analyze queues one job per brew log, and repeat requests reuse it", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const log = await newBrewLog(owner, ws.id, bean);
    const first = await owner.agent.post(`/api/brew-logs/${log}/analyze`);
    const second = await owner.agent.post(`/api/brew-logs/${log}/analyze`);
    expect(first.status).toBe(202);
    expect(second.body.jobId).toBe(first.body.jobId);
    expect(first.body.jobId).toBe(brewAnalysisJobId(log));

    const job = await brewAnalysisQueue.getJob(first.body.jobId);
    expect(job?.data).toEqual({ brewLogId: log });
    expect(job?.opts).toMatchObject({ attempts: 3, removeOnComplete: true, removeOnFail: true });
    expect(await brewAnalysisQueue.getWaitingCount()).toBe(1);
  });

  it("a workspace that keeps unrated brews from the AI refuses to analyze one (llm-contract.md §9)", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const unrated = await newBrewLog(owner, ws.id, bean);
    const rated = await newBrewLog(owner, ws.id, bean, { rating: 4 });
    await owner.agent.patch(`/api/workspaces/${ws.id}/settings`).send({ aiHidden: ["analyzeUnrated"] });

    const refused = await owner.agent.post(`/api/brew-logs/${unrated}/analyze`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Rate this brew first/);
    expect((await owner.agent.post(`/api/brew-logs/${rated}/analyze`)).status).toBe(202);

    await owner.agent.patch(`/api/workspaces/${ws.id}/settings`).send({ aiHidden: [] });
    expect((await owner.agent.post(`/api/brew-logs/${unrated}/analyze`)).status).toBe(202);
  });

  it("suggestions can be rated useful or not, by who can analyze the brew (docs/api/analysis.md §8)", async () => {
    const { owner, ws } = await setup();
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    const bean = await newBean(owner, ws.id);
    const log = await newBrewLog(owner, ws.id, bean);
    const other = await newBrewLog(owner, ws.id, bean);
    const { db } = await import("../src/db.js");
    const { llmAnalyses } = await import("@barista/shared/schema");
    const id = crypto.randomUUID();
    await db.insert(llmAnalyses).values({ id, brewLogId: log, reasoning: "r", suggestedGrindDelta: "finer", suggestedTempDelta: 0, model: "m", promptVersion: "v" });
    const url = `/api/brew-logs/${log}/analyses/${id}/feedback`;

    expect((await owner.agent.put(url).send({ helpful: true })).body).toEqual({ helpful: true });
    const stored = (await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs/${log}`)).body.brewLog.latestAnalysis;
    expect(stored).toMatchObject({ helpful: true, ratedAt: expect.any(String), model: "m", promptVersion: "v" });
    expect((await owner.agent.put(url).send({ helpful: null })).status).toBe(200);
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs/${log}`)).body.brewLog.latestAnalysis).toMatchObject({ helpful: null, ratedAt: null });

    expect((await owner.agent.put(url).send({ helpful: "yes" })).status).toBe(400);
    expect((await viewer.agent.put(url).send({ helpful: false })).status).toBe(403);
    expect((await owner.agent.put(`/api/brew-logs/${other}/analyses/${id}/feedback`).send({ helpful: false })).status).toBe(404); // another brew's
  });

  it("viewers can't analyze; outsiders can't tell whether a log or bean exists", async () => {
    const { owner, ws } = await setup();
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    const bean = await newBean(owner, ws.id);
    const log = await newBrewLog(owner, ws.id, bean);
    const fake = "00000000-0000-4000-8000-000000000000";

    expect((await viewer.agent.post(`/api/brew-logs/${log}/analyze`)).status).toBe(403);
    const real = await outsider.agent.post(`/api/brew-logs/${log}/analyze`);
    const missing = await outsider.agent.post(`/api/brew-logs/${fake}/analyze`);
    expect([real.status, missing.status]).toEqual([404, 404]);
    expect(real.body).toEqual(missing.body);
    const realBean = await outsider.agent.get(`/api/beans/${bean}/suggestions`);
    const missingBean = await outsider.agent.get(`/api/beans/${fake}/suggestions`);
    expect(realBean.body).toEqual(missingBean.body);
    expect(await brewAnalysisQueue.getWaitingCount()).toBe(0);
  });
});

describe("public menu", () => {
  it("shows the builder's menu, only when enabled, only at the exact slug", async () => {
    const { owner, ws } = await setup();
    const menu = `/api/public/menu/${ws.slug}`;
    await newBean(owner, ws.id, { beanName: "Shown" });
    await newBean(owner, ws.id, { beanName: "Hidden", showOnPublicMenu: false });
    const foamId = (await owner.agent.post(`/api/workspaces/${ws.id}/ingredients`).send({ name: "Orange cold foam", ingredientType: "foam" })).body.ingredient.id;
    const drinks = `/api/workspaces/${ws.id}/drinks`;
    const atlas = (await owner.agent.post(drinks).send({ name: "The Atlas", description: "V60 with orange cold foam", kind: "filter", ingredients: [{ ingredientId: foamId, amountValue: 40, amountUnit: "g" }] })).body.drink.id;
    await owner.agent.post(drinks).send({ name: "Not placed", kind: "filter" });
    const specialty = await menuSection(owner, ws.id, "Specialty");
    await menuAdd(owner, ws.id, specialty, { itemType: "drink", drinkId: atlas });
    await menuAdd(owner, ws.id, specialty, { itemType: "beans" });

    expect((await request(app).get(menu)).status).toBe(404); // not enabled yet
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    const res = await request(app).get(menu);
    expect(res.status).toBe(200);
    // Only placed items; names of ingredients only, no recipe details.
    expect(res.body.sections).toEqual([
      {
        name: "Specialty",
        description: null,
        items: [
          { type: "drink", id: atlas, name: "The Atlas", description: "V60 with orange cold foam", method: "Filter", variantOf: null, ingredients: ["Orange cold foam"], price: null, available: true },
          { type: "beans", fields: expect.any(Array), beans: [expect.objectContaining({ beanName: "Shown" })] },
        ],
      },
    ]);
    expect(res.body.recipes).toBeUndefined();
    expect((await request(app).get(menu.toUpperCase().replace("/API/PUBLIC/MENU/", "/api/public/menu/"))).status).toBe(404);
  });
});
