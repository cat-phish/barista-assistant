import { describe, expect, it } from "vitest";
import { brewerId, newBean, newUser, newWorkspace, type TestUser, styleId } from "./helpers.js";

// Method kinds and espresso recipes/logs (docs/api/README.md §3, §5, §6).

async function setup(): Promise<{ owner: TestUser; ws: { id: string; slug: string }; v60: string; espresso: string }> {
  const owner = await newUser("owner");
  const ws = await newWorkspace(owner);
  return { owner, ws, v60: await brewerId(owner, ws.id, "V60"), espresso: await brewerId(owner, ws.id, "Espresso") };
}

const shot = (brewerId: string, extra: Record<string, unknown> = {}) => ({
  name: "Classic 1:2",
  brewerId,
  targetDoseGrams: 18,
  expectedYieldGrams: 36,
  ...extra,
});

describe("method kinds", () => {
  it("new workspaces seed brew methods; new brewers default to filter", async () => {
    const { owner, ws } = await setup();
    const base = `/api/workspaces/${ws.id}/brewers`;
    const kinds = Object.fromEntries(
      (await owner.agent.get(base)).body.brewers.map((m: { name: string; kind: string }) => [m.name, m.kind])
    );
    expect(kinds).toEqual({ Aeropress: "filter", Espresso: "espresso", V60: "filter" });
    expect((await owner.agent.post(base).send({ name: "Chemex" })).body.brewer.kind).toBe("filter");
    expect((await owner.agent.post(base).send({ name: "OXO", style: "immersion" })).status).toBe(400); // style lives on recipes
    expect((await owner.agent.post(base).send({ name: "Lever", kind: "espresso" })).body.brewer).toMatchObject({ kind: "espresso" });
    expect((await owner.agent.post(base).send({ name: "Bialetti", kind: "stovetop" })).body.brewer).toMatchObject({ kind: "stovetop" });
    expect((await owner.agent.post(base).send({ name: "Siphon", kind: "other" })).body.brewer).toMatchObject({ kind: "other" });
    expect((await owner.agent.post(base).send({ name: "Mystery", kind: "vacuum" })).status).toBe(400);
  });

  it("stovetop and other recipes follow filter's rules, with their own styles", async () => {
    const { owner, ws } = await setup();
    const brewer = async (name: string, kind: string) =>
      (await owner.agent.post(`/api/workspaces/${ws.id}/brewers`).send({ name, kind })).body.brewer.id as string;
    const moka = await brewer("Bialetti", "stovetop");
    const siphon = await brewer("Hario siphon", "other");
    const recipes = `/api/workspaces/${ws.id}/recipes`;
    const recipe = (brewerId: string, extra: Record<string, unknown>) =>
      owner.agent.post(recipes).send({ name: `R ${Math.random()}`, brewerId, targetDoseGrams: 15, ...extra });
    const style = (kind: string, key: string) => styleId(owner, ws.id, kind, key);
    const ids = {
      espresso_soup: await style("espresso", "soup"),
      filter_pour_over: await style("filter", "pour_over"),
      other_other: await style("other", "other"),
      stovetop_ibrik: await style("stovetop", "ibrik"),
      stovetop_moka: await style("stovetop", "moka"),
    };
    // Dose + water, like filter.
    expect((await recipe(moka, { styleId: await style("stovetop", "moka") })).status).toBe(400); // needs water
    const created = await recipe(moka, { targetWaterGrams: 150, styleId: await style("stovetop", "moka") });
    expect(created.status).toBe(201);
    expect(created.body.recipe).toMatchObject({ style: { name: "Moka", brewsLike: "moka" }, brewer: { kind: "stovetop" } });
    expect((await recipe(moka, { targetWaterGrams: 150, styleId: await style("stovetop", "ibrik") })).status).toBe(201);
    expect((await recipe(moka, { targetWaterGrams: 150, styleId: await style("espresso", "soup") })).status).toBe(400); // an espresso style
    expect((await recipe(moka, { targetWaterGrams: 150, styleId: await style("filter", "pour_over") })).status).toBe(400); // a filter style
    expect((await recipe(siphon, { targetWaterGrams: 300, styleId: await style("other", "other") })).status).toBe(201);
    expect((await recipe(siphon, { targetWaterGrams: 300, styleId: await style("stovetop", "moka") })).status).toBe(400);
    // Drinks can need either method.
    const drinks = `/api/workspaces/${ws.id}/drinks`;
    expect((await owner.agent.post(drinks).send({ name: "Moka latte", kind: "stovetop" })).body.drink.kind).toBe("stovetop");
    expect((await owner.agent.post(drinks).send({ name: "Siphon special", kind: "other" })).body.drink.kind).toBe("other");
  });

  it("kind can't change while recipes use the method; renames keep the kind", async () => {
    const { owner, ws, v60 } = await setup();
    const base = `/api/workspaces/${ws.id}/brewers`;
    await owner.agent.post(`/api/workspaces/${ws.id}/recipes`).send({ name: "R", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 });

    const refused = await owner.agent.patch(`${base}/${v60}`).send({ kind: "espresso" });
    expect(refused.status).toBe(409);
    expect(refused.body.recipeCount).toBe(1);
    expect((await owner.agent.patch(`${base}/${v60}`).send({ kind: "filter", name: "Hario V60" })).body.brewer).toEqual({
      id: v60,
      name: "Hario V60",
      kind: "filter",
      methodId: expect.any(String),
      notes: null,
      preinfusion: "none",
      flowControl: "none",
      pressureControl: "none",
      archivedAt: null,
      createdAt: expect.any(String),
    });
    expect((await owner.agent.patch(`${base}/${v60}`).send({})).status).toBe(400);
    // Brewers have no category or menu fields (grouped by method; the menu
    // builder places them, §7b): old clients sending them get a 400.
    for (const field of [{ categoryId: null }, { menuName: "Espresso" }, { description: "Fruity" }, { showOnPublicMenu: true }]) {
      expect((await owner.agent.patch(`${base}/${v60}`).send(field)).status, JSON.stringify(field)).toBe(400);
      expect((await owner.agent.post(base).send({ name: "Chemex", ...field })).status, JSON.stringify(field)).toBe(400);
    }
  });
});

describe("espresso recipes", () => {
  it("need a target yield and no water; the response carries the method kind", async () => {
    const { owner, ws, espresso } = await setup();
    const base = `/api/workspaces/${ws.id}/recipes`;
    const ok = await owner.agent.post(base).send(shot(espresso, { expectedFinishMinSec: 25, expectedFinishMaxSec: 32 }));
    expect(ok.status).toBe(201);
    expect(ok.body.recipe).toMatchObject({ brewer: { id: espresso, kind: "espresso" }, targetWaterGrams: null, expectedYieldGrams: 36 });

    expect((await owner.agent.post(base).send(shot(espresso, { expectedYieldGrams: null }))).body.error).toMatch(/expectedYieldGrams/);
    expect((await owner.agent.post(base).send(shot(espresso, { targetWaterGrams: 50 }))).body.error).toMatch(/targetWaterGrams/);
    const pourStep = { steps: [{ stepType: "pour", durationSec: 5, targetWaterGrams: 40 }] };
    expect((await owner.agent.post(base).send(shot(espresso, pourStep))).status).toBe(400);
    const waitStep = { steps: [{ stepType: "soak", label: "Bloom", durationSec: 8 }] };
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

    const pourOver = { name: "R", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250, firstDropMinSec: 6 };
    expect((await owner.agent.post(base).send(pourOver)).body.error).toMatch(/firstDropMinSec/);
  });

  it("PATCH checks the recipe as it will be: switching kind needs the new kind's fields", async () => {
    const { owner, ws, v60, espresso } = await setup();
    const base = `/api/workspaces/${ws.id}/recipes`;
    const created = await owner.agent.post(base).send({
      name: "R",
      brewerId: v60,
      targetDoseGrams: 15,
      targetWaterGrams: 250,
      steps: [{ stepType: "pour", durationSec: 30, targetWaterGrams: 250 }],
    });
    const url = `${base}/${created.body.recipe.id}`;

    expect((await owner.agent.patch(url).send({ brewerId: espresso })).status).toBe(400); // still has water
    expect((await owner.agent.patch(url).send({ brewerId: espresso, targetWaterGrams: null, expectedYieldGrams: 36 })).status).toBe(400); // pour step left
    const switched = await owner.agent.patch(url).send({ brewerId: espresso, targetWaterGrams: null, expectedYieldGrams: 36, steps: [] });
    expect(switched.status).toBe(200);
    expect(switched.body.recipe.brewer.kind).toBe("espresso");
    expect((await owner.agent.patch(url).send({ name: "Renamed" })).status).toBe(200);
    expect((await owner.agent.patch(url).send({ expectedYieldGrams: null })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ brewerId: v60 })).body.error).toMatch(/targetWaterGrams: is required/);
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
    const recipe = (await owner.agent.post(recipes).send({ name: "R", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const log = (await owner.agent.post(base).send({ beanId: bean, recipeId: recipe, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 })).body.brewLog.id as string;
    await owner.agent.patch(`${recipes}/${recipe}`).send({ brewerId: espresso, targetWaterGrams: null, expectedYieldGrams: 36 });

    expect((await owner.agent.patch(`${base}/${log}`).send({ rating: 4 })).status).toBe(200);
    expect((await owner.agent.patch(`${base}/${log}`).send({ actualWaterGrams: 260 })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/${log}`).send({ recipeId: null })).status).toBe(200);
  });
});

describe("espresso profiles and marks", () => {
  it("profile steps: pressure until first drop, soak, flow ramp until done", async () => {
    const { owner, ws, v60, espresso } = await setup();
    const base = `/api/workspaces/${ws.id}/recipes`;
    const profile = [
      { stepType: "pressure", pressureBar: 9, advance: "first_drop", durationSec: null },
      { stepType: "soak", durationSec: 10 },
      { stepType: "flow", flowRate: 4, flowEndRate: 2, durationSec: null },
    ];
    const ok = await owner.agent.post(base).send(shot(espresso, { steps: profile, flowUnit: "ml_s" }));
    expect(ok.status).toBe(201);
    expect(ok.body.recipe.flowUnit).toBe("ml_s");
    expect(ok.body.recipe.steps).toMatchObject([
      { stepType: "pressure", pressureBar: 9, pressureEndBar: null, advance: "first_drop", durationSec: null },
      { stepType: "soak", durationSec: 10, advance: "auto" },
      { stepType: "flow", flowRate: 4, flowEndRate: 2, durationSec: null },
    ]);
    const timed = [
      { stepType: "preinfusion", pressureBar: 3, durationSec: 10 },
      { stepType: "soak", durationSec: 10 },
      { stepType: "pressure", pressureBar: 9, pressureEndBar: 6, durationSec: null },
    ];
    expect((await owner.agent.post(base).send(shot(espresso, { steps: timed }))).status).toBe(201);

    const bad = async (steps: unknown[]) => (await owner.agent.post(base).send(shot(espresso, { steps }))).body.error as string;
    expect(await bad([{ stepType: "pressure", durationSec: 5 }])).toMatch(/pressureBar: is required/);
    expect(await bad([{ stepType: "flow", flowEndRate: 2, flowRate: null, durationSec: 5 }])).toMatch(/flowRate/);
    expect(await bad([{ stepType: "preinfusion", pressureBar: 3, flowRate: 2, durationSec: 5 }])).toMatch(/not both/);
    expect(await bad([{ stepType: "soak", pressureBar: 1, durationSec: 5 }])).toMatch(/isn't allowed for a soak step/);
    expect(await bad([{ stepType: "pressure", pressureBar: 25, durationSec: 5 }])).toMatch(/pressureBar/);
    const twoDrops = [{ stepType: "soak", advance: "first_drop" }, { stepType: "soak", advance: "first_drop" }];
    expect(await bad(twoDrops)).toMatch(/at most one step can end at first drop/);
    expect((await owner.agent.post(base).send(shot(espresso, { flowUnit: "oz_s" }))).status).toBe(400);
    const filter = { name: "F", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250, steps: [timed[0]] };
    expect((await owner.agent.post(base).send(filter)).body.error).toMatch(/espresso recipes/);
  });

  it("marks: first drop for espresso, step_end per step; PATCH replaces them", async () => {
    const { owner, ws, v60, espresso } = await setup();
    const bean = await newBean(owner, ws.id);
    const recipes = `/api/workspaces/${ws.id}/recipes`;
    const recipe = (await owner.agent.post(recipes).send(shot(espresso))).body.recipe.id as string;
    const base = `/api/workspaces/${ws.id}/brew-logs`;
    const log = { beanId: bean, recipeId: recipe, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 };

    const created = await owner.agent.post(base).send({
      ...log,
      marks: [{ kind: "step_end", stepOrder: 2, atSec: 17.5 }, { kind: "first_drop", atSec: 7.4 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.brewLog.marks).toEqual([
      { kind: "first_drop", stepOrder: null, atSec: 7.4 },
      { kind: "step_end", stepOrder: 2, atSec: 17.5 },
    ]);
    const id = created.body.brewLog.id as string;

    const post = async (marks: unknown[]) => owner.agent.post(base).send({ ...log, marks });
    expect((await post([{ kind: "first_drop", atSec: 7 }, { kind: "first_drop", atSec: 8 }])).status).toBe(400);
    expect((await post([{ kind: "step_end", atSec: 7 }])).status).toBe(400); // no stepOrder
    expect((await post([{ kind: "first_drop", stepOrder: 1, atSec: 7 }])).status).toBe(400);
    expect((await post([{ kind: "step_end", stepOrder: 1, atSec: 5 }, { kind: "step_end", stepOrder: 1, atSec: 6 }])).status).toBe(400);
    expect((await post([{ kind: "first_drop", atSec: 30 }])).body.error).toMatch(/within actualTimeSec/);
    expect((await post([{ kind: "first_drop", atSec: 7.25 }])).status).toBe(400);
    expect((await post([{ kind: "preinfusion_end", atSec: 7 }])).status).toBe(400);

    expect((await owner.agent.patch(`${base}/${id}`).send({ marks: [{ kind: "first_drop", atSec: 8 }] })).body.brewLog.marks).toEqual([
      { kind: "first_drop", stepOrder: null, atSec: 8 },
    ]);
    expect((await owner.agent.patch(`${base}/${id}`).send({ actualTimeSec: 5 })).body.error).toMatch(/within actualTimeSec/);
    expect((await owner.agent.patch(`${base}/${id}`).send({ tastingNotes: "Sweet" })).body.brewLog.marks).toHaveLength(1);
    expect((await owner.agent.patch(`${base}/${id}`).send({ marks: [] })).body.brewLog.marks).toEqual([]);

    // Pour-over: step_end marks are fine (a tap-to-continue bloom); a first drop isn't.
    const filter = (await owner.agent.post(recipes).send({ name: "F", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id;
    const filterLog = { beanId: bean, recipeId: filter, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };
    expect((await owner.agent.post(base).send({ ...filterLog, marks: [{ kind: "step_end", stepOrder: 1, atSec: 52 }] })).status).toBe(201);
    expect((await owner.agent.post(base).send({ ...filterLog, marks: [{ kind: "first_drop", atSec: 7 }] })).body.error).toMatch(/first drop/);
    // step_end needs a recipe to point into.
    const noRecipe = { beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };
    expect((await owner.agent.post(base).send({ ...noRecipe, marks: [{ kind: "step_end", stepOrder: 1, atSec: 52 }] })).body.error).toMatch(/needs a recipe/);
  });
});

describe("recipe styles", () => {
  it("a recipe's style must fit its brewer's method; moving brewers clears one that no longer does", async () => {
    const { owner, ws, v60, espresso } = await setup();
    const base = `/api/workspaces/${ws.id}/recipes`;
    const filter = { name: "F", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 };
    const style = (kind: string, key: string) => styleId(owner, ws.id, kind, key);
    const ids = {
      espresso_soup: await style("espresso", "soup"),
      espresso_standard: await style("espresso", "standard"),
      filter_cold_brew: await style("filter", "cold_brew"),
      filter_immersion: await style("filter", "immersion"),
      filter_pour_over: await style("filter", "pour_over"),
    };
    const made = await owner.agent.post(base).send({ ...filter, styleId: ids.filter_immersion }); // a V60 Switch-style recipe
    expect(made.body.recipe.style).toMatchObject({ name: "Immersion", brewsLike: "immersion" });
    expect((await owner.agent.post(base).send({ ...filter, styleId: ids.espresso_soup })).body.error).toMatch(/not a style for filter recipes/);
    expect((await owner.agent.post(base).send({ ...filter, styleId: "vacuum" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ ...filter, styleId: crypto.randomUUID() })).body.error).toMatch(/not a style of this workspace/);
    expect((await owner.agent.post(base).send({ ...filter, name: "Cold brew", styleId: ids.filter_cold_brew })).body.recipe.style.brewsLike).toBe("cold_brew");
    expect((await owner.agent.post(base).send(filter)).body.recipe.style).toBeNull();

    const soup = await owner.agent.post(base).send(shot(espresso, { name: "Soup shot", styleId: ids.espresso_soup, expectedYieldGrams: 90 }));
    expect(soup.body.recipe).toMatchObject({ style: { name: "Soup", brewsLike: "soup" }, brewer: { kind: "espresso" } });
    expect((await owner.agent.post(base).send(shot(espresso, { styleId: ids.filter_pour_over }))).status).toBe(400);
    expect((await owner.agent.post(base).send(shot(espresso, { styleId: ids.filter_cold_brew }))).status).toBe(400);

    // Moving the filter recipe to the espresso machine drops "immersion".
    const url = `${base}/${made.body.recipe.id}`;
    const moved = await owner.agent.patch(url).send({ brewerId: espresso, targetWaterGrams: null, expectedYieldGrams: 36, steps: [] });
    expect(moved.body.recipe).toMatchObject({ style: null, brewer: { kind: "espresso" } });
    expect((await owner.agent.patch(url).send({ styleId: ids.espresso_standard })).body.recipe.style.name).toBe("Standard");
    expect((await owner.agent.patch(url).send({ styleId: null })).body.recipe.style).toBeNull();
  });
});
