import { describe, expect, it } from "vitest";
import { brewerId, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/recipes`;
  const v60 = await brewerId(owner, ws.id, "V60");
  const recipe = { name: "House V60", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 };
  const grinder = async (name: string) =>
    (await owner.agent.post(`/api/workspaces/${ws.id}/grinders`).send({ name })).body.grinder.id as string;
  return { owner, ws, base, recipe, grinder };
}

describe("recipe fields", () => {
  it("water is required; expected yield, finish time and temp are optional and nullable", async () => {
    const { owner, base, recipe } = await setup();
    const { targetWaterGrams: _omit, ...noWater } = recipe;
    expect((await owner.agent.post(base).send(noWater)).body.error).toMatch(/targetWaterGrams/);

    const full = await owner.agent.post(base).send({ ...recipe, expectedYieldGrams: 220, expectedFinishMinSec: 165, expectedFinishMaxSec: 195, targetTempC: 94 });
    expect(full.body.recipe).toMatchObject({ targetWaterGrams: 250, expectedYieldGrams: 220, expectedFinishMinSec: 165, expectedFinishMaxSec: 195, targetTempC: 94, grindSettings: [], steps: [] });
    const cleared = await owner.agent.patch(`${base}/${full.body.recipe.id}`).send({ expectedYieldGrams: null, expectedFinishMaxSec: null });
    expect(cleared.body.recipe).toMatchObject({ expectedYieldGrams: null, expectedFinishMinSec: null, expectedFinishMaxSec: null, targetTempC: 94 });
    expect((await owner.agent.post(base).send({ ...recipe, targetGrindSetting: "20" })).status).toBe(201); // unknown keys ignored on create
    expect((await owner.agent.patch(`${base}/${full.body.recipe.id}`).send({ targetGrindSetting: "20" })).status).toBe(400); // rejected on PATCH
  });
});

describe("date added", () => {
  it("is set on create, returned in the list, and can't be sent", async () => {
    const { owner, base, recipe } = await setup();
    const before = Date.now() - 2000;
    const made = (await owner.agent.post(base).send(recipe)).body.recipe;
    expect(new Date(made.createdAt).getTime()).toBeGreaterThanOrEqual(before);
    const listed = (await owner.agent.get(base)).body.recipes[0];
    expect(listed.createdAt).toBe(made.createdAt);
    expect((await owner.agent.patch(`${base}/${made.id}`).send({ createdAt: "2020-01-01T00:00:00.000Z" })).status).toBe(400);
  });
});

describe("target finish window", () => {
  it("one end alone defaults the other to ±15 s (never below 0); both must be in order", async () => {
    const { owner, base, recipe } = await setup();
    const window = async (body: Record<string, unknown>) => {
      const res = await owner.agent.post(base).send({ ...recipe, ...body });
      return res.status === 201 ? [res.body.recipe.expectedFinishMinSec, res.body.recipe.expectedFinishMaxSec] : res.body.error;
    };
    expect(await window({ expectedFinishMinSec: 165 })).toEqual([165, 180]);
    expect(await window({ expectedFinishMaxSec: 195 })).toEqual([180, 195]);
    expect(await window({ expectedFinishMaxSec: 10 })).toEqual([0, 10]);
    expect(await window({ expectedFinishMinSec: 86395 })).toEqual([86395, 86400]);
    expect(await window({ expectedFinishMinSec: 180, expectedFinishMaxSec: 180 })).toEqual([180, 180]);
    expect(await window({})).toEqual([null, null]);
    expect(await window({ expectedFinishMinSec: 200, expectedFinishMaxSec: 190 })).toMatch(/must not be after/);
  });

  it("PATCH: one end re-derives the other; omitting both leaves it alone", async () => {
    const { owner, base, recipe } = await setup();
    const id = (await owner.agent.post(base).send({ ...recipe, expectedFinishMinSec: 165, expectedFinishMaxSec: 195 })).body.recipe.id;
    const patch = async (body: Record<string, unknown>) => {
      const r = (await owner.agent.patch(`${base}/${id}`).send(body)).body.recipe;
      return [r.expectedFinishMinSec, r.expectedFinishMaxSec];
    };
    expect(await patch({ name: "Renamed" })).toEqual([165, 195]);
    expect(await patch({ expectedFinishMinSec: 200 })).toEqual([200, 215]);
  });
});

describe("grind starting points", () => {
  it("one per grinder, named, sorted, replaced as a whole on PATCH", async () => {
    const { owner, base, recipe, grinder } = await setup();
    const ode = await grinder("Ode");
    const c40 = await grinder("Comandante C40");
    const res = await owner.agent.post(base).send({ ...recipe, grindSettings: [{ grinderId: ode, setting: " 4.2 " }, { grinderId: c40, setting: "20" }] });
    expect(res.body.recipe.grindSettings).toEqual([
      { grinderId: c40, grinderName: "Comandante C40", setting: "20" },
      { grinderId: ode, grinderName: "Ode", setting: "4.2" },
    ]);
    const replaced = await owner.agent.patch(`${base}/${res.body.recipe.id}`).send({ grindSettings: [{ grinderId: ode, setting: "5" }] });
    expect(replaced.body.recipe.grindSettings).toEqual([{ grinderId: ode, grinderName: "Ode", setting: "5" }]);
    const untouched = await owner.agent.patch(`${base}/${res.body.recipe.id}`).send({ name: "Renamed" });
    expect(untouched.body.recipe.grindSettings).toHaveLength(1);
  });

  it("refuses duplicates and other workspaces' grinders; survives retirement, goes with grinder deletion", async () => {
    const { owner, ws, base, recipe, grinder } = await setup();
    const c40 = await grinder("C40");
    expect((await owner.agent.post(base).send({ ...recipe, grindSettings: [{ grinderId: c40, setting: "20" }, { grinderId: c40, setting: "21" }] })).body.error).toMatch(/more than once/);
    const other = await newUser();
    const otherWs = await newWorkspace(other);
    const foreign = (await other.agent.post(`/api/workspaces/${otherWs.id}/grinders`).send({ name: "Theirs" })).body.grinder.id;
    expect((await owner.agent.post(base).send({ ...recipe, grindSettings: [{ grinderId: foreign, setting: "1" }] })).body.error).toMatch(/grinderId/);

    const id = (await owner.agent.post(base).send({ ...recipe, grindSettings: [{ grinderId: c40, setting: "20" }] })).body.recipe.id;
    await owner.agent.patch(`/api/workspaces/${ws.id}/grinders/${c40}`).send({ retired: true });
    expect((await owner.agent.get(base)).body.recipes.find((r: { id: string }) => r.id === id).grindSettings).toHaveLength(1);
    await owner.agent.delete(`/api/workspaces/${ws.id}/grinders/${c40}`); // unused by brews, so deletable
    expect((await owner.agent.get(base)).body.recipes.find((r: { id: string }) => r.id === id).grindSettings).toEqual([]);
  });
});

describe("recipe steps", () => {
  const bloom = { stepType: "bloom", durationSec: 10, targetWaterGrams: 45 };

  it("stores typed steps back to back: duration, how each moves on, values", async () => {
    const { owner, base, recipe } = await setup();
    const steps = [
      { ...bloom, advance: "tap", targetTempC: 85 }, // waits for the kettle
      { stepType: "swirl", durationSec: 0 }, // instant
      { stepType: "wait", durationSec: 20 },
      { stepType: "bloom", label: " Second bloom ", durationSec: 10, advance: "auto_log", targetWaterGrams: 90 },
      { stepType: "pour", durationSec: 60, targetWaterGrams: 250, targetTempC: 93 },
      { stepType: "wait", label: "Drawdown", durationSec: null }, // until you finish
    ];
    const res = await owner.agent.post(base).send({ ...recipe, steps });
    expect(res.status).toBe(201);
    const shape = (s: Record<string, unknown>) => [s.stepOrder, s.stepType, s.label, s.durationSec, s.advance, s.targetWaterGrams, s.targetTempC];
    expect(res.body.recipe.steps.map(shape)).toEqual([
      [1, "bloom", null, 10, "tap", 45, 85],
      [2, "swirl", null, 0, "auto", null, null],
      [3, "wait", null, 20, "auto", null, null],
      [4, "bloom", "Second bloom", 10, "auto_log", 90, null],
      [5, "pour", null, 60, "auto", 250, 93],
      [6, "wait", "Drawdown", null, "auto", null, null],
    ]);
    expect(res.body.recipe).toMatchObject({ flowUnit: "g_s" });
    // A tap step's duration is only a guide, so it can be left out.
    expect((await owner.agent.post(base).send({ ...recipe, steps: [{ ...bloom, durationSec: undefined, advance: "tap" }] })).status).toBe(201);
  });

  it.each([
    ["water missing on a pour", [{ stepType: "pour", durationSec: 30 }], /required for a pour step/],
    ["water on a swirl", [{ stepType: "swirl", durationSec: 5, targetWaterGrams: 50 }], /isn't allowed for a swirl step/],
    ["an auto step without a duration", [{ stepType: "stir" }], /durationSec/],
    ["open-ended before the last step", [{ stepType: "wait", durationSec: null }, bloom], /only the last step/],
    ["an open-ended auto_log step", [{ stepType: "wait", durationSec: null, advance: "auto_log" }], /auto_log/],
    ["pour-to going down", [bloom, { stepType: "pour", durationSec: 20, targetWaterGrams: 40 }], /less than an earlier step/],
    ["pressure on a pour-over", [{ stepType: "other", label: "x", durationSec: 5, pressureBar: 9 }], /espresso/],
    ["first drop on a pour-over", [{ ...bloom, advance: "first_drop" }], /espresso/],
    ["an espresso step type", [{ stepType: "soak", durationSec: 10 }], /espresso/],
    ["unknown type", [{ stepType: "flip", durationSec: 5 }], /stepType/],
  ])("rejects %s", async (_label, steps, error) => {
    const { owner, base, recipe } = await setup();
    const res = await owner.agent.post(base).send({ ...recipe, steps });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(error);
  });

  it("pour-to is compared across water steps only (non-water steps in between are fine)", async () => {
    const { owner, base, recipe } = await setup();
    const steps = [bloom, { stepType: "stir", durationSec: 5 }, { stepType: "pour", durationSec: 25, targetWaterGrams: 45 }];
    expect((await owner.agent.post(base).send({ ...recipe, steps })).status).toBe(201);
  });
});

describe("brew logs: water vs measured yield", () => {
  it("water is required; measured yield optional and nullable", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    expect((await owner.agent.post(base).send({ beanId: bean, actualDoseGrams: 15, actualTimeSec: 150 })).body.error).toMatch(/actualWaterGrams/);
    const id = await newBrewLog(owner, ws.id, bean, { actualYieldGrams: 225 });
    const log = (await owner.agent.get(`${base}/${id}`)).body.brewLog;
    expect(log).toMatchObject({ actualWaterGrams: 250, actualYieldGrams: 225 });
    expect((await owner.agent.patch(`${base}/${id}`).send({ actualYieldGrams: null })).body.brewLog.actualYieldGrams).toBeNull();
  });

  it("brew logs carry the recipe's expected yield for comparison", async () => {
    const { owner, ws, base: recipesBase, recipe } = await setup();
    const bean = await newBean(owner, ws.id);
    const r = (await owner.agent.post(recipesBase).send({ ...recipe, style: "pour_over", expectedYieldGrams: 220 })).body.recipe.id;
    const id = await newBrewLog(owner, ws.id, bean, { recipeId: r, actualYieldGrams: 226 });
    const log = (await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs/${id}`)).body.brewLog;
    expect(log.recipe).toEqual({ id: r, name: "House V60", expectedYieldGrams: 220, style: "pour_over", methodKind: "filter" });
    expect(log.actualYieldGrams).toBe(226);
  });

  it("TDS is optional: > 0, at most 30, two decimals; PATCH clears it (docs/api/brew-logs.md §6)", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const id = await newBrewLog(owner, ws.id, bean, { actualYieldGrams: 220, tdsPercent: 1.38 });
    expect((await owner.agent.get(`${base}/${id}`)).body.brewLog.tdsPercent).toBe(1.38);
    expect((await owner.agent.get(base)).body.brewLogs[0].tdsPercent).toBe(1.38);
    expect((await owner.agent.patch(`${base}/${id}`).send({ tdsPercent: 9.75 })).body.brewLog.tdsPercent).toBe(9.75);
    expect((await owner.agent.patch(`${base}/${id}`).send({ tdsPercent: null })).body.brewLog.tdsPercent).toBeNull();
    for (const tdsPercent of [0, -1, 30.01, 1.385, "1.38"]) {
      const res = await owner.agent.post(base).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, tdsPercent });
      expect(res.status, String(tdsPercent)).toBe(400);
    }
  });
});
