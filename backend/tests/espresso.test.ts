import { describe, expect, it } from "vitest";
import { methodId, newBean, newUser, newWorkspace, type TestUser } from "./helpers.js";

// Method kinds and espresso recipes/logs (docs/api_spec.md §3, §5, §6).

async function setup(): Promise<{ owner: TestUser; ws: { id: string; slug: string }; v60: string; espresso: string }> {
  const owner = await newUser("owner");
  const ws = await newWorkspace(owner);
  return { owner, ws, v60: await methodId(owner, ws.id, "V60"), espresso: await methodId(owner, ws.id, "Espresso") };
}

const shot = (methodId: string, extra: Record<string, unknown> = {}) => ({
  name: "Classic 1:2",
  methodId,
  targetDoseGrams: 18,
  expectedYieldGrams: 36,
  ...extra,
});

describe("method kinds", () => {
  it("new workspaces seed kinds; new methods default to pour over", async () => {
    const { owner, ws } = await setup();
    const base = `/api/workspaces/${ws.id}/brew-methods`;
    const kinds = Object.fromEntries(
      (await owner.agent.get(base)).body.brewMethods.map((m: { name: string; kind: string }) => [m.name, m.kind])
    );
    expect(kinds).toEqual({ Aeropress: "immersion", Espresso: "espresso", Latte: "espresso", V60: "pour_over" });
    expect((await owner.agent.post(base).send({ name: "Chemex" })).body.brewMethod.kind).toBe("pour_over");
    expect((await owner.agent.post(base).send({ name: "Lever", kind: "espresso" })).body.brewMethod).toMatchObject({ kind: "espresso" });
    expect((await owner.agent.post(base).send({ name: "Siphon", kind: "vacuum" })).status).toBe(400);
  });

  it("kind can't change while recipes use the method; renames keep the kind", async () => {
    const { owner, ws, v60 } = await setup();
    const base = `/api/workspaces/${ws.id}/brew-methods`;
    expect((await owner.agent.patch(`${base}/${v60}`).send({ kind: "immersion" })).body.brewMethod).toMatchObject({ name: "V60", kind: "immersion" });
    expect((await owner.agent.patch(`${base}/${v60}`).send({ kind: "pour_over" })).status).toBe(200);
    await owner.agent.post(`/api/workspaces/${ws.id}/recipes`).send({ name: "R", methodId: v60, targetDoseGrams: 15, targetWaterGrams: 250 });

    const refused = await owner.agent.patch(`${base}/${v60}`).send({ kind: "espresso" });
    expect(refused.status).toBe(409);
    expect(refused.body.recipeCount).toBe(1);
    expect((await owner.agent.patch(`${base}/${v60}`).send({ kind: "pour_over", name: "Hario V60" })).body.brewMethod).toEqual({
      id: v60,
      name: "Hario V60",
      kind: "pour_over",
    });
    expect((await owner.agent.patch(`${base}/${v60}`).send({})).status).toBe(400);
  });
});

describe("espresso recipes", () => {
  it("need a target yield and no water; the response carries the method kind", async () => {
    const { owner, ws, espresso } = await setup();
    const base = `/api/workspaces/${ws.id}/recipes`;
    const ok = await owner.agent.post(base).send(shot(espresso, { expectedFinishMinSec: 25, expectedFinishMaxSec: 32 }));
    expect(ok.status).toBe(201);
    expect(ok.body.recipe).toMatchObject({ method: { id: espresso, kind: "espresso" }, targetWaterGrams: null, expectedYieldGrams: 36 });

    expect((await owner.agent.post(base).send(shot(espresso, { expectedYieldGrams: null }))).body.error).toMatch(/expectedYieldGrams/);
    expect((await owner.agent.post(base).send(shot(espresso, { targetWaterGrams: 50 }))).body.error).toMatch(/targetWaterGrams/);
    const pourStep = { steps: [{ stepType: "pour", startSec: 0, endSec: 5, targetWaterGrams: 40 }] };
    expect((await owner.agent.post(base).send(shot(espresso, pourStep))).status).toBe(400);
    const waitStep = { steps: [{ stepType: "wait", label: "Pre-infusion", startSec: 0, endSec: 8 }] };
    expect((await owner.agent.post(base).send(shot(espresso, waitStep))).status).toBe(201);
  });

  it("first-drop window: a pair with a ±3 s default, espresso only", async () => {
    const { owner, ws, v60, espresso } = await setup();
    const base = `/api/workspaces/${ws.id}/recipes`;
    const res = await owner.agent.post(base).send(shot(espresso, { firstDropMinSec: 6 }));
    expect(res.body.recipe).toMatchObject({ firstDropMinSec: 6, firstDropMaxSec: 9 });
    const id = res.body.recipe.id as string;
    expect((await owner.agent.patch(`${base}/${id}`).send({ firstDropMaxSec: 10 })).body.recipe).toMatchObject({ firstDropMinSec: 7, firstDropMaxSec: 10 });
    expect((await owner.agent.patch(`${base}/${id}`).send({ firstDropMinSec: 9, firstDropMaxSec: 5 })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/${id}`).send({ firstDropMinSec: null })).body.recipe).toMatchObject({ firstDropMinSec: null, firstDropMaxSec: null });

    const pourOver = { name: "R", methodId: v60, targetDoseGrams: 15, targetWaterGrams: 250, firstDropMinSec: 6 };
    expect((await owner.agent.post(base).send(pourOver)).body.error).toMatch(/firstDropMinSec/);
  });

  it("PATCH checks the recipe as it will be: switching kind needs the new kind's fields", async () => {
    const { owner, ws, v60, espresso } = await setup();
    const base = `/api/workspaces/${ws.id}/recipes`;
    const created = await owner.agent.post(base).send({
      name: "R",
      methodId: v60,
      targetDoseGrams: 15,
      targetWaterGrams: 250,
      steps: [{ stepType: "pour", startSec: 0, endSec: 30, targetWaterGrams: 250 }],
    });
    const url = `${base}/${created.body.recipe.id}`;

    expect((await owner.agent.patch(url).send({ methodId: espresso })).status).toBe(400); // still has water
    expect((await owner.agent.patch(url).send({ methodId: espresso, targetWaterGrams: null, expectedYieldGrams: 36 })).status).toBe(400); // pour step left
    const switched = await owner.agent.patch(url).send({ methodId: espresso, targetWaterGrams: null, expectedYieldGrams: 36, steps: [] });
    expect(switched.status).toBe(200);
    expect(switched.body.recipe.method.kind).toBe("espresso");
    expect((await owner.agent.patch(url).send({ name: "Renamed" })).status).toBe(200);
    expect((await owner.agent.patch(url).send({ expectedYieldGrams: null })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ methodId: v60 })).body.error).toMatch(/targetWaterGrams: is required/);
  });
});

describe("espresso brew logs", () => {
  it("record the shot weight instead of water", async () => {
    const { owner, ws, espresso } = await setup();
    const bean = await newBean(owner, ws.id);
    const recipe = (await owner.agent.post(`/api/workspaces/${ws.id}/recipes`).send(shot(espresso))).body.recipe.id as string;
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const log = { beanId: bean, recipeId: recipe, actualDoseGrams: 18, actualTimeSec: 28 };

    expect((await owner.agent.post(base).send(log)).body.error).toMatch(/actualYieldGrams/);
    expect((await owner.agent.post(base).send({ ...log, actualYieldGrams: 37, actualWaterGrams: 40 })).body.error).toMatch(/actualWaterGrams/);
    const ok = await owner.agent.post(base).send({ ...log, actualYieldGrams: 37.5 });
    expect(ok.status).toBe(201);
    expect(ok.body.brewLog).toMatchObject({ actualWaterGrams: null, actualYieldGrams: 37.5, recipe: { id: recipe, methodKind: "espresso" } });

    // Without a recipe (or with a pour-over one) water is still required.
    expect((await owner.agent.post(base).send({ beanId: bean, actualDoseGrams: 15, actualTimeSec: 150 })).body.error).toMatch(/actualWaterGrams/);
    expect((await owner.agent.patch(`${base}/${ok.body.brewLog.id}`).send({ actualYieldGrams: null })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/${ok.body.brewLog.id}`).send({ tastingNotes: "Syrupy" })).status).toBe(200);
  });

  it("old logs stay editable after their recipe moves to another kind", async () => {
    const { owner, ws, v60, espresso } = await setup();
    const bean = await newBean(owner, ws.id);
    const recipes = `/api/workspaces/${ws.id}/recipes`;
    const recipe = (await owner.agent.post(recipes).send({ name: "R", methodId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const log = (await owner.agent.post(base).send({ beanId: bean, recipeId: recipe, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 })).body.brewLog.id as string;
    await owner.agent.patch(`${recipes}/${recipe}`).send({ methodId: espresso, targetWaterGrams: null, expectedYieldGrams: 36 });

    expect((await owner.agent.patch(`${base}/${log}`).send({ rating: 4 })).status).toBe(200);
    expect((await owner.agent.patch(`${base}/${log}`).send({ actualWaterGrams: 260 })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/${log}`).send({ recipeId: null })).status).toBe(200);
  });
});

describe("pre-infusion steps and shot marks", () => {
  it("pre-infusion steps are espresso-only, at most one", async () => {
    const { owner, ws, v60, espresso } = await setup();
    const base = `/api/workspaces/${ws.id}/recipes`;
    const pi = { stepType: "preinfusion", startSec: 0, endSec: 8 };
    const ok = await owner.agent.post(base).send(shot(espresso, { steps: [pi] }));
    expect(ok.body.recipe.steps).toMatchObject([{ stepType: "preinfusion", startSec: 0, endSec: 8, targetWaterGrams: null }]);
    expect((await owner.agent.post(base).send(shot(espresso, { steps: [pi, { ...pi, startSec: 8, endSec: 10 }] }))).body.error).toMatch(/at most one/);
    const filter = { name: "F", methodId: v60, targetDoseGrams: 15, targetWaterGrams: 250, steps: [pi] };
    expect((await owner.agent.post(base).send(filter)).body.error).toMatch(/espresso recipes/);
  });

  it("espresso logs save marks (earliest first); PATCH replaces them; other brews can't have them", async () => {
    const { owner, ws, v60, espresso } = await setup();
    const bean = await newBean(owner, ws.id);
    const recipes = `/api/workspaces/${ws.id}/recipes`;
    const recipe = (await owner.agent.post(recipes).send(shot(espresso))).body.recipe.id as string;
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const log = { beanId: bean, recipeId: recipe, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 };

    const created = await owner.agent.post(base).send({ ...log, marks: [{ kind: "first_drop", atSec: 7.4 }, { kind: "preinfusion_end", atSec: 6 }] });
    expect(created.status).toBe(201);
    expect(created.body.brewLog.marks).toEqual([{ kind: "preinfusion_end", atSec: 6 }, { kind: "first_drop", atSec: 7.4 }]);
    const id = created.body.brewLog.id as string;
    expect((await owner.agent.get(`${base}/${id}`)).body.brewLog.marks).toHaveLength(2);

    expect((await owner.agent.post(base).send({ ...log, marks: [{ kind: "first_drop", atSec: 7 }, { kind: "first_drop", atSec: 8 }] })).status).toBe(400);
    expect((await owner.agent.post(base).send({ ...log, marks: [{ kind: "first_drop", atSec: 30 }] })).body.error).toMatch(/within actualTimeSec/);
    expect((await owner.agent.post(base).send({ ...log, marks: [{ kind: "first_drop", atSec: 7.25 }] })).status).toBe(400);
    expect((await owner.agent.post(base).send({ ...log, marks: [{ kind: "crema", atSec: 7 }] })).status).toBe(400);

    expect((await owner.agent.patch(`${base}/${id}`).send({ marks: [{ kind: "first_drop", atSec: 8 }] })).body.brewLog.marks).toEqual([{ kind: "first_drop", atSec: 8 }]);
    expect((await owner.agent.patch(`${base}/${id}`).send({ actualTimeSec: 5 })).body.error).toMatch(/within actualTimeSec/);
    expect((await owner.agent.patch(`${base}/${id}`).send({ tastingNotes: "Sweet" })).body.brewLog.marks).toHaveLength(1);
    expect((await owner.agent.patch(`${base}/${id}`).send({ marks: [] })).body.brewLog.marks).toEqual([]);

    const filter = (await owner.agent.post(recipes).send({ name: "F", methodId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id;
    const filterLog = { beanId: bean, recipeId: filter, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, marks: [{ kind: "first_drop", atSec: 7 }] };
    expect((await owner.agent.post(base).send(filterLog)).body.error).toMatch(/only espresso brews record marks/);
  });
});
