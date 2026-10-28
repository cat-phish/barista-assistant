import { describe, expect, it } from "vitest";
import { brewerId, newBean, newBrewLog, newUser, newWorkspace, styleId } from "./helpers.js";

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
    const res = await owner.agent.post(base).send({ ...recipe, grindSettings: [{ grinderId: ode, setting: 4.2 }, { grinderId: c40, setting: 20 }] });
    expect(res.body.recipe.grindSettings).toEqual([
      { grinderId: c40, grinderName: "Comandante C40", setting: 20 },
      { grinderId: ode, grinderName: "Ode", setting: 4.2 },
    ]);
    const replaced = await owner.agent.patch(`${base}/${res.body.recipe.id}`).send({ grindSettings: [{ grinderId: ode, setting: 5 }] });
    expect(replaced.body.recipe.grindSettings).toEqual([{ grinderId: ode, grinderName: "Ode", setting: 5 }]);
    const untouched = await owner.agent.patch(`${base}/${res.body.recipe.id}`).send({ name: "Renamed" });
    expect(untouched.body.recipe.grindSettings).toHaveLength(1);    // A number on the dial (docs/api/recipes.md §5): no text, at most 2 decimals.
    for (const setting of ["20", "18 clicks", 20.125, -1, 10000]) {
      const bad = await owner.agent.post(base).send({ ...recipe, grindSettings: [{ grinderId: ode, setting }] });
      expect(bad.status, String(setting)).toBe(400);
    }
  });

  it("refuses duplicates and other workspaces' grinders; survives archiving, goes with grinder deletion", async () => {
    const { owner, ws, base, recipe, grinder } = await setup();
    const c40 = await grinder("C40");
    expect((await owner.agent.post(base).send({ ...recipe, grindSettings: [{ grinderId: c40, setting: 20 }, { grinderId: c40, setting: 21 }] })).body.error).toMatch(/more than once/);
    const other = await newUser();
    const otherWs = await newWorkspace(other);
    const foreign = (await other.agent.post(`/api/workspaces/${otherWs.id}/grinders`).send({ name: "Theirs" })).body.grinder.id;
    expect((await owner.agent.post(base).send({ ...recipe, grindSettings: [{ grinderId: foreign, setting: 1 }] })).body.error).toMatch(/grinderId/);

    const id = (await owner.agent.post(base).send({ ...recipe, grindSettings: [{ grinderId: c40, setting: 20 }] })).body.recipe.id;
    await owner.agent.patch(`/api/workspaces/${ws.id}/grinders/${c40}`).send({ archived: true });
    expect((await owner.agent.get(base)).body.recipes.find((r: { id: string }) => r.id === id).grindSettings).toHaveLength(1);
    await owner.agent.delete(`/api/workspaces/${ws.id}/grinders/${c40}`); // unused by brews, so deletable
    expect((await owner.agent.get(base)).body.recipes.find((r: { id: string }) => r.id === id).grindSettings).toEqual([]);
  });
});

describe("default prep (docs/api/recipes.md §5 prepToolIds)", () => {
  it("in checklist order, replaced as a whole on PATCH; only this workspace's tools; a deleted tool drops off", async () => {
    const { owner, ws, base, recipe } = await setup();
    const tools = `/api/workspaces/${ws.id}/prep-tools`;
    const byName = async (w: string, name: string) => ((await owner.agent.get(`/api/workspaces/${w}/prep-tools`)).body.tools as Array<{ id: string; name: string }>).find((t) => t.name === name)!.id;
    const [rinsed, rdt] = [await byName(ws.id, "Rinsed paper filter"), await byName(ws.id, "RDT")];

    expect((await owner.agent.post(base).send(recipe)).body.recipe.prepToolIds).toEqual([]);
    const res = await owner.agent.post(base).send({ ...recipe, name: "Prepped", prepToolIds: [rdt, rinsed] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.recipe.prepToolIds).toEqual([rinsed, rdt]); // the tools' order, not the sent one
    const id = res.body.recipe.id as string;
    expect((await owner.agent.patch(`${base}/${id}`).send({ targetTempC: 93 })).body.recipe.prepToolIds).toHaveLength(2);
    expect((await owner.agent.patch(`${base}/${id}`).send({ prepToolIds: [rdt] })).body.recipe.prepToolIds).toEqual([rdt]);

    const other = await newWorkspace(owner);
    const theirs = await byName(other.id, "RDT");
    const foreign = await owner.agent.patch(`${base}/${id}`).send({ prepToolIds: [theirs] });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toMatch(/prepToolIds/);
    expect((await owner.agent.post(base).send({ ...recipe, name: "Twice", prepToolIds: [rdt, rdt] })).status).toBe(400);

    expect((await owner.agent.get(`${tools}/${rdt}/usage`)).body).toEqual({ brewLogCount: 0, recipeCount: 1 });
    expect((await owner.agent.delete(`${tools}/${rdt}`)).status).toBe(204);
    expect((await owner.agent.get(base)).body.recipes.find((r: { id: string }) => r.id === id).prepToolIds).toEqual([]);
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
    const pourOver = await styleId(owner, ws.id, "filter", "pour_over");
    const r = (await owner.agent.post(recipesBase).send({ ...recipe, styleId: pourOver, expectedYieldGrams: 220 })).body.recipe.id;
    const id = await newBrewLog(owner, ws.id, bean, { recipeId: r, actualYieldGrams: 226 });
    const log = (await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs/${id}`)).body.brewLog;
    expect(log.recipe).toEqual({ id: r, name: "House V60", expectedYieldGrams: 220, style: { id: pourOver, name: "Pour over", brewsLike: "pour_over" }, methodKind: "filter" });
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

  it("bean weight in and ground coffee out are optional; out can't be more than in (docs/api/brew-logs.md §6)", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const id = await newBrewLog(owner, ws.id, bean, { beanWeightInGrams: 18.2, groundWeightOutGrams: 17.95 });
    expect((await owner.agent.get(`${base}/${id}`)).body.brewLog).toMatchObject({ beanWeightInGrams: 18.2, groundWeightOutGrams: 17.95, actualDoseGrams: 15 });
    expect((await owner.agent.get(base)).body.brewLogs[0]).toMatchObject({ beanWeightInGrams: 18.2 });
    await newBrewLog(owner, ws.id, bean, { beanWeightInGrams: 18 }); // one alone is fine (newBrewLog expects 201)
    await newBrewLog(owner, ws.id, bean, { groundWeightOutGrams: 18 });

    const post = (fields: Record<string, unknown>) =>
      owner.agent.post(base).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, ...fields });
    expect((await post({ beanWeightInGrams: 18, groundWeightOutGrams: 18.1 })).status).toBe(400);
    for (const beanWeightInGrams of [0, -1, 1000, 18.005, "18"]) {
      expect((await post({ beanWeightInGrams })).status, String(beanWeightInGrams)).toBe(400);
    }

    // PATCH checks the pair after the change.
    expect((await owner.agent.patch(`${base}/${id}`).send({ beanWeightInGrams: 17.9 })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/${id}`).send({ groundWeightOutGrams: 18 })).body.brewLog).toMatchObject({ beanWeightInGrams: 18.2, groundWeightOutGrams: 18 });
    expect((await owner.agent.patch(`${base}/${id}`).send({ beanWeightInGrams: null })).body.brewLog).toMatchObject({ beanWeightInGrams: null, groundWeightOutGrams: 18 });
  });
});

describe("cold styles (docs/api/recipes.md §5)", () => {
  it("steep window in hours (a pair), fridge or room, and the serving dilution", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const base = `/api/workspaces/${ws.id}/recipes`;
    const brewer = await brewerId(owner, ws.id, "V60");
    const cold = await styleId(owner, ws.id, "filter", "cold_brew");
    const recipe = { name: "Fridge cold brew", brewerId: brewer, targetDoseGrams: 100, targetWaterGrams: 800, styleId: cold };
    const made = await owner.agent.post(base).send({ ...recipe, steepMinHours: 12, steepMaxHours: 18, steepTemp: "fridge", dilutionRatio: 1, dilutionWith: "water" });
    expect(made.status).toBe(201);
    expect(made.body.recipe).toMatchObject({ steepMinHours: 12, steepMaxHours: 18, steepTemp: "fridge", dilutionRatio: 1, dilutionWith: "water" });
    const url = `${base}/${made.body.recipe.id}`;
    expect((await owner.agent.patch(url).send({ steepMaxHours: 20 })).status).toBe(400); // one end alone
    expect((await owner.agent.patch(url).send({ steepMinHours: 10, steepMaxHours: 16.5 })).body.recipe).toMatchObject({ steepMinHours: 10, steepMaxHours: 16.5 });
    expect((await owner.agent.patch(url).send({ steepMinHours: null })).body.recipe).toMatchObject({ steepMinHours: null, steepMaxHours: null });
    for (const bad of [
      { steepMinHours: 18, steepMaxHours: 12 },
      { steepMinHours: 0.2, steepMaxHours: 12 },
      { steepMinHours: 12, steepMaxHours: 80 },
      { steepTemp: "freezer" },
      { dilutionRatio: 0 },
      { dilutionRatio: 1.25 },
      { dilutionWith: "juice" },
    ]) {
      expect((await owner.agent.post(base).send({ ...recipe, name: "x", ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    // A new workspace has the new built-ins.
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/recipe-styles`)).body.styles.map((s: { builtin: string | null }) => s.builtin)).toEqual(
      expect.arrayContaining(["rapid_cold", "kyoto_drip"]),
    );
  });
});

describe("flash chilled: brewed onto ice (docs/api/recipes.md §5, brew-logs.md §6)", () => {
  it("recipes and brews keep their ice, optional and nullable; not for espresso", async () => {
    const { owner, ws, base, recipe } = await setup();
    const bean = await newBean(owner, ws.id);
    const logs = `/api/workspaces/${ws.id}/brew-logs`;
    const iced = await owner.agent.post(base).send({ ...recipe, targetWaterGrams: 150, targetIceGrams: 100, expectedYieldGrams: 225 });
    expect(iced.body.recipe).toMatchObject({ targetWaterGrams: 150, targetIceGrams: 100, expectedYieldGrams: 225 });
    expect((await owner.agent.post(base).send(recipe)).body.recipe.targetIceGrams).toBeNull();
    expect((await owner.agent.patch(`${base}/${iced.body.recipe.id}`).send({ targetIceGrams: null })).body.recipe.targetIceGrams).toBeNull();
    expect((await owner.agent.post(base).send({ ...recipe, targetIceGrams: 0 })).status).toBe(400);

    const id = await newBrewLog(owner, ws.id, bean, { recipeId: iced.body.recipe.id, actualWaterGrams: 150, actualIceGrams: 100, actualYieldGrams: 228 });
    expect((await owner.agent.get(`${logs}/${id}`)).body.brewLog).toMatchObject({ actualWaterGrams: 150, actualIceGrams: 100, actualYieldGrams: 228 });
    expect((await owner.agent.patch(`${logs}/${id}`).send({ actualIceGrams: null })).body.brewLog.actualIceGrams).toBeNull();

    const gaggia = (await owner.agent.post(`/api/workspaces/${ws.id}/brewers`).send({ name: "Gaggia", kind: "espresso" })).body.brewer.id;
    const shot = { name: "Shot", brewerId: gaggia, targetDoseGrams: 18, expectedYieldGrams: 36 };
    expect((await owner.agent.post(base).send({ ...shot, targetIceGrams: 50 })).body.error).toMatch(/targetIceGrams/);
    // Moving an iced recipe to an espresso brewer needs its ice cleared too.
    const moved = await owner.agent.patch(`${base}/${iced.body.recipe.id}`).send({ targetIceGrams: 100 });
    expect(moved.status).toBe(200);
    expect((await owner.agent.patch(`${base}/${iced.body.recipe.id}`).send({ brewerId: gaggia, targetWaterGrams: null, expectedYieldGrams: 36 })).body.error).toMatch(/targetIceGrams/);
    const shotId = (await owner.agent.post(base).send(shot)).body.recipe.id;
    const espressoLog = { beanId: bean, recipeId: shotId, actualDoseGrams: 18, actualWaterGrams: null, actualYieldGrams: 36, actualTimeSec: 28 };
    expect((await owner.agent.post(logs).send({ ...espressoLog, actualIceGrams: 50 })).body.error).toMatch(/actualIceGrams/);
  });

  it("a brew made onto ice takes no TDS reading, checked after a PATCH", async () => {
    const { owner, ws } = await setup();
    const bean = await newBean(owner, ws.id);
    const logs = `/api/workspaces/${ws.id}/brew-logs`;
    const res = await owner.agent.post(logs).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 150, actualIceGrams: 100, actualTimeSec: 150, tdsPercent: 1.3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tdsPercent/);

    const iced = await newBrewLog(owner, ws.id, bean, { actualWaterGrams: 150, actualIceGrams: 100 });
    expect((await owner.agent.patch(`${logs}/${iced}`).send({ tdsPercent: 1.3 })).status).toBe(400);
    const measured = await newBrewLog(owner, ws.id, bean, { actualYieldGrams: 220, tdsPercent: 1.38 });
    expect((await owner.agent.patch(`${logs}/${measured}`).send({ actualIceGrams: 100 })).status).toBe(400);
    // Both at once: ice in, TDS out.
    expect((await owner.agent.patch(`${logs}/${measured}`).send({ actualIceGrams: 100, tdsPercent: null })).body.brewLog).toMatchObject({ actualIceGrams: 100, tdsPercent: null });
  });
});

describe("step times with the batch (docs/api/recipes.md §5)", () => {
  it("stepTimeScaling: optional, nullable, above 0 to 1, filter only", async () => {
    const { owner, ws, base, recipe } = await setup();
    const scaled = await owner.agent.post(base).send({ ...recipe, stepTimeScaling: 0.5 });
    expect(scaled.status).toBe(201);
    expect(scaled.body.recipe.stepTimeScaling).toBe(0.5);
    expect((await owner.agent.post(base).send(recipe)).body.recipe.stepTimeScaling).toBeNull();
    const id = scaled.body.recipe.id;
    expect((await owner.agent.patch(`${base}/${id}`).send({ stepTimeScaling: 1 })).body.recipe.stepTimeScaling).toBe(1);
    expect((await owner.agent.patch(`${base}/${id}`).send({ stepTimeScaling: null })).body.recipe.stepTimeScaling).toBeNull();
    for (const bad of [0, -0.5, 1.01, 0.555, "0.5"]) {
      expect((await owner.agent.post(base).send({ ...recipe, stepTimeScaling: bad })).status, JSON.stringify(bad)).toBe(400);
    }

    const gaggia = (await owner.agent.post(`/api/workspaces/${ws.id}/brewers`).send({ name: "Gaggia", kind: "espresso" })).body.brewer.id;
    const shot = { name: "Shot", brewerId: gaggia, targetDoseGrams: 18, expectedYieldGrams: 36 };
    expect((await owner.agent.post(base).send({ ...shot, stepTimeScaling: 0.5 })).body.error).toMatch(/stepTimeScaling/);
    // Moving a scaling recipe to an espresso brewer needs it cleared too.
    await owner.agent.patch(`${base}/${id}`).send({ stepTimeScaling: 0.5 });
    expect((await owner.agent.patch(`${base}/${id}`).send({ brewerId: gaggia, targetWaterGrams: null, expectedYieldGrams: 36 })).body.error).toMatch(/stepTimeScaling/);
    expect((await owner.agent.patch(`${base}/${id}`).send({ brewerId: gaggia, targetWaterGrams: null, expectedYieldGrams: 36, stepTimeScaling: null })).status).toBe(200);
  });
});
