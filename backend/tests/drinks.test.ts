import { describe, expect, it } from "vitest";
import { brewerId, newBean, newUser, newWorkspace, type TestUser } from "./helpers.js";

// Ingredients (§5b), drinks (§5c), drink categories (§5d), drinks on brew logs
// (§6) and the menu sections (§7).

interface Setup {
  owner: TestUser;
  ws: { id: string; slug: string };
  base: string;
  v60: string;
  espresso: string;
  v60a: string;
  v60b: string;
  shot: string;
}

async function setup(): Promise<Setup> {
  const owner = await newUser("owner");
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}`;
  const [v60, espresso] = [await brewerId(owner, ws.id, "V60"), await brewerId(owner, ws.id, "Espresso")];
  const recipe = async (body: Record<string, unknown>) => (await owner.agent.post(`${base}/recipes`).send(body)).body.recipe.id as string;
  const v60a = await recipe({ name: "V60 A", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 });
  const v60b = await recipe({ name: "V60 B", brewerId: v60, targetDoseGrams: 20, targetWaterGrams: 320 });
  const shot = await recipe({ name: "Classic", brewerId: espresso, targetDoseGrams: 18, expectedYieldGrams: 36 });
  return { owner, ws, base, v60, espresso, v60a, v60b, shot };
}

describe("ingredients", () => {
  it("CRUD with types and instructions; names unique; deleting a used one takes it out of its drinks", async () => {
    const { owner, base, v60 } = await setup();
    const created = await owner.agent.post(`${base}/ingredients`).send({ name: "Orange cold foam", ingredientType: "foam", instructions: " Infuse cream with orange peel overnight. " });
    expect(created.status).toBe(201);
    expect(created.body.ingredient).toEqual({
      id: expect.any(String),
      name: "Orange cold foam",
      ingredientType: "foam",
      instructions: "Infuse cream with orange peel overnight.",
      drinkCount: 0,
      archivedAt: null,
      createdAt: expect.any(String),
    });
    const id = created.body.ingredient.id as string;
    expect((await owner.agent.post(`${base}/ingredients`).send({ name: "Ice" })).body.ingredient.ingredientType).toBe("other");
    expect((await owner.agent.post(`${base}/ingredients`).send({ name: "orange cold foam" })).status).toBe(409);
    expect((await owner.agent.post(`${base}/ingredients`).send({ name: "X", ingredientType: "sprinkles" })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/ingredients/${id}`).send({ instructions: null })).body.ingredient.instructions).toBeNull();

    await owner.agent.post(`${base}/drinks`).send({ name: "The Atlas", kind: "filter", ingredients: [{ ingredientId: id }] });
    expect((await owner.agent.get(`${base}/ingredients`)).body.ingredients.find((c: { id: string }) => c.id === id).drinkCount).toBe(1);
    // Deleting it takes it out of the drink, which stays.
    expect((await owner.agent.get(`${base}/ingredients/${id}/usage`)).body).toEqual({ drinkCount: 1 });
    expect((await owner.agent.delete(`${base}/ingredients/${id}`)).status).toBe(204);
    const atlas = (await owner.agent.get(`${base}/drinks`)).body.drinks.find((d: { name: string }) => d.name === "The Atlas");
    expect(atlas.ingredients).toEqual([]);
  });
});

describe("drinks", () => {
  it("are built on a brewer with an optional default recipe and ingredients in order", async () => {
    const { owner, base, v60, v60b } = await setup();
    const foam = (await owner.agent.post(`${base}/ingredients`).send({ name: "Orange cold foam", ingredientType: "foam" })).body.ingredient.id;
    const syrup = (await owner.agent.post(`${base}/ingredients`).send({ name: "Vanilla", ingredientType: "syrup" })).body.ingredient.id;
    const res = await owner.agent.post(`${base}/drinks`).send({
      name: "The Atlas",
      description: "V60 with orange cold foam",
      kind: "filter",
      defaultRecipeId: v60b,
      ingredients: [
        { ingredientId: syrup, amountValue: 1, amountUnit: " pump " },
        { ingredientId: foam, amountValue: 40, amountUnit: "g", note: "spooned on top" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.drink).toEqual({
      id: expect.any(String),
      name: "The Atlas",
      description: "V60 with orange cold foam",
      kind: "filter",
      category: null,
      parent: null,
      variants: [],
      defaultRecipeId: v60b,
      servingSize: null,
      servingUnit: null,
      archivedAt: null,
      createdAt: expect.any(String),
      instructions: null,
      ingredients: [
        { ingredientId: syrup, name: "Vanilla", ingredientType: "syrup", amountValue: 1, amountUnit: "pump", note: null },
        { ingredientId: foam, name: "Orange cold foam", ingredientType: "foam", amountValue: 40, amountUnit: "g", note: "spooned on top" },
      ],
    });
    expect((await owner.agent.post(`${base}/drinks`).send({ name: "No default", kind: "filter" })).body.drink.defaultRecipeId).toBeNull();
  });

  it("validates the kind, the default recipe's kind, the category, the parent and ingredients", async () => {
    const { owner, base, v60a, shot } = await setup();
    const other = await setup();
    const post = async (body: Record<string, unknown>) => (await owner.agent.post(`${base}/drinks`).send({ name: "D", ...body })).body.error as string;
    expect(await post({})).toMatch(/kind/);
    expect(await post({ kind: "cold_brew" })).toMatch(/kind/);
    expect(await post({ kind: "filter", defaultRecipeId: shot })).toMatch(/recipe of the drink's kind/); // espresso recipe for a filter drink
    expect(await post({ kind: "filter", defaultRecipeId: other.v60a })).toMatch(/recipe of the drink's kind/); // another workspace's
    const foreignCategory = (await other.owner.agent.post(`${other.base}/drink-categories`).send({ name: "C" })).body.category.id;
    expect(await post({ kind: "filter", categoryId: foreignCategory })).toMatch(/not a category in this workspace/);
    const foreignDrink = (await other.owner.agent.post(`${other.base}/drinks`).send({ name: "X", kind: "filter" })).body.drink.id;
    expect(await post({ kind: "filter", parentDrinkId: foreignDrink })).toMatch(/not a drink in this workspace/);
    const foreign = (await other.owner.agent.post(`${other.base}/ingredients`).send({ name: "Ice" })).body.ingredient.id;
    expect(await post({ kind: "filter", defaultRecipeId: v60a, ingredients: [{ ingredientId: foreign }] })).toMatch(/not an ingredient in this workspace/);
  });

  it("PATCH: changing the kind clears a default of the old kind", async () => {
    const { owner, base, v60a, v60b, shot } = await setup();
    const id = (await owner.agent.post(`${base}/drinks`).send({ name: "D", kind: "filter", defaultRecipeId: v60a })).body.drink.id;
    const url = `${base}/drinks/${id}`;
    expect((await owner.agent.patch(url).send({ defaultRecipeId: v60b })).body.drink.defaultRecipeId).toBe(v60b);
    expect((await owner.agent.patch(url).send({ defaultRecipeId: shot })).status).toBe(400);
    const moved = (await owner.agent.patch(url).send({ kind: "espresso" })).body.drink;
    expect(moved).toMatchObject({ kind: "espresso", defaultRecipeId: null });
    expect((await owner.agent.patch(url).send({ defaultRecipeId: shot })).body.drink.defaultRecipeId).toBe(shot);
    expect((await owner.agent.patch(url).send({ kind: "filter", defaultRecipeId: v60a })).body.drink.defaultRecipeId).toBe(v60a);
    expect((await owner.agent.patch(url).send({ description: "" })).body.drink).toMatchObject({ description: null });
    // The menu builder places drinks now (§7b): the old flag is refused.
    expect((await owner.agent.patch(url).send({ showOnPublicMenu: false })).status).toBe(400);
    expect((await owner.agent.post(`${base}/drinks`).send({ name: "Old client", kind: "filter", showOnPublicMenu: true })).status).toBe(400);
  });

  it("deleting a recipe clears it as a default", async () => {
    const { owner, base, v60, v60a } = await setup();
    const id = (await owner.agent.post(`${base}/drinks`).send({ name: "D", kind: "filter", defaultRecipeId: v60a })).body.drink.id;
    await owner.agent.delete(`${base}/recipes/${v60a}`);
    const drink = (await owner.agent.get(`${base}/drinks`)).body.drinks.find((d: { id: string }) => d.id === id);
    expect(drink.defaultRecipeId).toBeNull();
  });

  it("drinks don't tie up brewers: deleting an unused brewer works with drinks of its kind", async () => {
    const { owner, base } = await setup();
    const chemex = (await owner.agent.post(`${base}/brewers`).send({ name: "Chemex" })).body.brewer.id;
    await owner.agent.post(`${base}/drinks`).send({ name: "Chemex tonic", kind: "filter" });
    expect((await owner.agent.delete(`${base}/brewers/${chemex}`)).status).toBe(204);
  });

  it("any brewer of the drink's kind can make it; a recipe of another kind can't", async () => {
    const { owner, ws, base, v60a, shot } = await setup();
    const bean = await newBean(owner, ws.id);
    const chemex = (await owner.agent.post(`${base}/brewers`).send({ name: "Chemex" })).body.brewer.id;
    const chemexRecipe = (await owner.agent.post(`${base}/recipes`).send({ name: "Chemex 1:15", brewerId: chemex, targetDoseGrams: 30, targetWaterGrams: 450 })).body.recipe.id;
    const atlas = (await owner.agent.post(`${base}/drinks`).send({ name: "The Atlas", kind: "filter", defaultRecipeId: v60a })).body.drink.id;
    // The default can be any pour-over brewer's recipe.
    expect((await owner.agent.patch(`${base}/drinks/${atlas}`).send({ defaultRecipeId: chemexRecipe })).status).toBe(200);
    const filter = { beanId: bean, drinkId: atlas, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 180 };
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...filter, recipeId: v60a })).body.brewLog.brewer).toMatchObject({ name: "V60" });
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...filter, recipeId: chemexRecipe })).body.brewLog.brewer).toMatchObject({ name: "Chemex" });
    // Any filter brewer, whatever its style: The Atlas on an Aeropress too.
    const aeropress = await brewerId(owner, ws.id, "Aeropress");
    const apRecipe = (await owner.agent.post(`${base}/recipes`).send({ name: "Aeropress", brewerId: aeropress, targetDoseGrams: 15, targetWaterGrams: 230 })).body.recipe.id;
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...filter, recipeId: apRecipe })).body.brewLog.brewer).toMatchObject({ name: "Aeropress", kind: "filter" });
    const espressoLog = { beanId: bean, drinkId: atlas, recipeId: shot, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 };
    expect((await owner.agent.post(`${base}/brew-logs`).send(espressoLog)).body.error).toMatch(/drink's kind/);
  });
});

describe("drink sizes", () => {
  it("a default size is a number and unit together; ingredient amounts are a value and free unit", async () => {
    const { owner, base, espresso } = await setup();
    const syrup = (await owner.agent.post(`${base}/ingredients`).send({ name: "Vanilla", ingredientType: "syrup" })).body.ingredient.id;
    const post = (body: Record<string, unknown>) => owner.agent.post(`${base}/drinks`).send({ name: "Latte", kind: "espresso", ...body });
    const ok = await post({ servingSize: 8, servingUnit: "fl_oz", ingredients: [{ ingredientId: syrup, amountValue: 2.5, amountUnit: "pump" }] });
    expect(ok.status).toBe(201);
    expect(ok.body.drink).toMatchObject({ servingSize: 8, servingUnit: "fl_oz", ingredients: [{ amountValue: 2.5, amountUnit: "pump" }] });

    expect((await post({ servingSize: 8 })).body.error).toMatch(/go together/);
    expect((await post({ servingUnit: "ml" })).body.error).toMatch(/go together/);
    expect((await post({ servingSize: 8, servingUnit: "cups" })).status).toBe(400);
    expect((await post({ servingSize: 0, servingUnit: "ml" })).status).toBe(400);
    expect((await post({ servingSize: 8.25, servingUnit: "fl_oz" })).status).toBe(400); // one decimal
    expect((await post({ ingredients: [{ ingredientId: syrup, amountValue: -1 }] })).status).toBe(400);
    expect((await post({ ingredients: [{ ingredientId: syrup, amount: "2 pumps" }] })).status).toBe(400); // the old field
    const toTaste = await post({ ingredients: [{ ingredientId: syrup, amountUnit: "to taste" }] });
    expect(toTaste.body.drink.ingredients[0]).toMatchObject({ amountValue: null, amountUnit: "to taste" });

    const url = `${base}/drinks/${ok.body.drink.id}`;
    expect((await owner.agent.patch(url).send({ servingSize: null })).body.error).toMatch(/go together/);
    expect((await owner.agent.patch(url).send({ servingSize: 350, servingUnit: "ml" })).body.drink).toMatchObject({ servingSize: 350, servingUnit: "ml" });
    expect((await owner.agent.patch(url).send({ servingSize: null, servingUnit: null })).body.drink.servingSize).toBeNull();
  });

  it("a brew log records the size made, only with a drink", async () => {
    const { owner, ws, base, espresso, shot } = await setup();
    const bean = await newBean(owner, ws.id);
    const latte = (await owner.agent.post(`${base}/drinks`).send({ name: "Latte", kind: "espresso", servingSize: 8, servingUnit: "fl_oz" })).body.drink.id;
    const log = { beanId: bean, recipeId: shot, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 };
    const made = await owner.agent.post(`${base}/brew-logs`).send({ ...log, drinkId: latte, servingSize: 12, servingUnit: "fl_oz" });
    expect(made.status).toBe(201);
    expect(made.body.brewLog).toMatchObject({ servingSize: 12, servingUnit: "fl_oz" });
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...log, servingSize: 12, servingUnit: "fl_oz" })).body.error).toMatch(/only for a brew made for a drink/);
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...log, drinkId: latte, servingSize: 12 })).body.error).toMatch(/go together/);

    const url = `${base}/brew-logs/${made.body.brewLog.id}`;
    expect((await owner.agent.patch(url).send({ drinkId: null })).status).toBe(400); // the size would be left without a drink
    expect((await owner.agent.patch(url).send({ servingUnit: null })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ drinkId: null, servingSize: null, servingUnit: null })).body.brewLog).toMatchObject({ drinkId: null, servingSize: null });
  });
});

describe("drink variants", () => {
  it("link to a parent at any depth, list their variants, and can't form loops", async () => {
    const { owner, base, espresso, shot } = await setup();
    const post = async (name: string, parentDrinkId?: string) =>
      (await owner.agent.post(`${base}/drinks`).send({ name, kind: "espresso", defaultRecipeId: shot, parentDrinkId })).body.drink;
    const latte = await post("Latte");
    const vanilla = await post("Vanilla Latte", latte.id);
    const iced = await post("Iced Vanilla Latte", vanilla.id);
    expect(vanilla.parent).toEqual({ id: latte.id, name: "Latte" });

    const byId = async () => new Map(((await owner.agent.get(`${base}/drinks`)).body.drinks as Array<{ id: string }>).map((d) => [d.id, d]));
    expect((await byId()).get(latte.id)).toMatchObject({ parent: null, variants: [{ id: vanilla.id, name: "Vanilla Latte" }] });
    expect((await byId()).get(vanilla.id)).toMatchObject({ variants: [{ id: iced.id, name: "Iced Vanilla Latte" }] });

    const patchParent = (id: string, parentDrinkId: string | null) => owner.agent.patch(`${base}/drinks/${id}`).send({ parentDrinkId });
    expect((await patchParent(latte.id, latte.id)).body.error).toMatch(/variant of itself/);
    expect((await patchParent(latte.id, iced.id)).body.error).toMatch(/its own variants/);
    expect((await patchParent(iced.id, latte.id)).body.drink.parent).toEqual({ id: latte.id, name: "Latte" });
    expect((await patchParent(iced.id, null)).body.drink.parent).toBeNull();
  });

  it("deleting a drink moves its variants up to its parent", async () => {
    const { owner, base, espresso } = await setup();
    const post = async (name: string, parentDrinkId?: string) => (await owner.agent.post(`${base}/drinks`).send({ name, kind: "espresso", parentDrinkId })).body.drink.id as string;
    const latte = await post("Latte");
    const vanilla = await post("Vanilla Latte", latte);
    const iced = await post("Iced Vanilla Latte", vanilla);
    const hot = await post("Extra Hot Vanilla Latte", vanilla);

    expect((await owner.agent.delete(`${base}/drinks/${vanilla}`)).status).toBe(204);
    const drinks = (await owner.agent.get(`${base}/drinks`)).body.drinks as Array<{ id: string; parent: { id: string } | null; variants: Array<{ id: string }> }>;
    expect(drinks.find((d) => d.id === iced)?.parent?.id).toBe(latte);
    expect(drinks.find((d) => d.id === hot)?.parent?.id).toBe(latte);
    expect(drinks.find((d) => d.id === latte)?.variants.map((v) => v.id).sort()).toEqual([iced, hot].sort());

    expect((await owner.agent.delete(`${base}/drinks/${latte}`)).status).toBe(204);
    const roots = (await owner.agent.get(`${base}/drinks`)).body.drinks as Array<{ parent: unknown }>;
    expect(roots.map((d) => d.parent)).toEqual([null, null]);
  });
});

describe("drink categories", () => {
  it("are an ordered list: create goes last, rename, reorder, delete uncategorises", async () => {
    const { owner, base, espresso, v60 } = await setup();
    const url = `${base}/drink-categories`;
    const create = async (name: string) => (await owner.agent.post(url).send({ name })).body.category;
    const milk = await create(" Espresso milk drinks ");
    const special = await create("Specialty drinks");
    expect(milk).toEqual({ id: expect.any(String), name: "Espresso milk drinks", position: 1 });
    expect(special.position).toBe(2);
    expect((await owner.agent.post(url).send({ name: "specialty DRINKS" })).status).toBe(409);
    expect((await owner.agent.post(url).send({ name: "" })).status).toBe(400);
    expect((await owner.agent.patch(`${url}/${special.id}`).send({ name: "Signatures" })).body.category.name).toBe("Signatures");

    expect((await owner.agent.put(`${url}/order`).send({ categoryIds: [special.id] })).status).toBe(400); // must list all
    const reordered = await owner.agent.put(`${url}/order`).send({ categoryIds: [special.id, milk.id] });
    expect(reordered.body.categories.map((c: { name: string; position: number }) => [c.name, c.position])).toEqual([
      ["Signatures", 1],
      ["Espresso milk drinks", 2],
    ]);

    const drink = (await owner.agent.post(`${base}/drinks`).send({ name: "Latte", kind: "espresso", categoryId: milk.id })).body.drink;
    expect(drink.category).toEqual({ id: milk.id, name: "Espresso milk drinks" });
    expect((await owner.agent.delete(`${url}/${milk.id}`)).status).toBe(204);
    expect((await owner.agent.get(`${base}/drinks`)).body.drinks[0].category).toBeNull();
    expect((await owner.agent.delete(`${url}/${milk.id}`)).status).toBe(404);
  });
});


describe("drinks on brew logs", () => {
  it("a brew for a drink uses a recipe of its brewer; deleting the drink keeps the log", async () => {
    const { owner, ws, base, v60, v60a, v60b, shot } = await setup();
    const bean = await newBean(owner, ws.id);
    const drink = (await owner.agent.post(`${base}/drinks`).send({ name: "The Atlas", kind: "filter", defaultRecipeId: v60a })).body.drink.id as string;
    const log = { beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };

    const ok = await owner.agent.post(`${base}/brew-logs`).send({ ...log, recipeId: v60a, drinkId: drink });
    expect(ok.status).toBe(201);
    expect(ok.body.brewLog).toMatchObject({ drinkId: drink, drink: { id: drink, name: "The Atlas" } });
    // Any recipe of the brewer works, not just the default.
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...log, recipeId: v60b, drinkId: drink })).status).toBe(201);
    const shotLog = { beanId: bean, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 };
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...shotLog, recipeId: shot, drinkId: drink })).body.error).toMatch(/drink's kind/);
    expect((await owner.agent.patch(`${base}/brew-logs/${ok.body.brewLog.id}`).send({ recipeId: shot, actualWaterGrams: null, actualYieldGrams: 36 })).status).toBe(400);
    expect((await owner.agent.post(`${base}/brew-logs`).send(log)).body.brewLog.drink).toBeNull();

    expect((await owner.agent.delete(`${base}/drinks/${drink}`)).status).toBe(204);
    expect((await owner.agent.get(`${base}/brew-logs/${ok.body.brewLog.id}`)).body.brewLog).toMatchObject({ drinkId: null, drink: null });
  });
});

describe("drink instructions and tasting", () => {
  it("instructions round-trip; blank becomes null", async () => {
    const { owner, base, espresso } = await setup();
    const text = "Add the syrup to the cup.\nPull the shot onto it, steam the milk and pour.";
    const made = (await owner.agent.post(`${base}/drinks`).send({ name: "Vanilla Latte", kind: "espresso", instructions: ` ${text} ` })).body.drink;
    expect(made.instructions).toBe(text);
    expect((await owner.agent.patch(`${base}/drinks/${made.id}`).send({ instructions: "" })).body.drink.instructions).toBeNull();
    expect((await owner.agent.post(`${base}/drinks`).send({ name: "X", kind: "espresso", instructions: "x".repeat(5001) })).status).toBe(400);
  });

  it("a drink brew rates the shot and the drink apart; the drink's tasting needs a drink", async () => {
    const { owner, ws, base, espresso, shot } = await setup();
    const bean = await newBean(owner, ws.id);
    const milk = (await owner.agent.post(`${base}/ingredients`).send({ name: "Steamed milk", ingredientType: "milk" })).body.ingredient.id;
    const latte = (await owner.agent.post(`${base}/drinks`).send({ name: "Latte", kind: "espresso", ingredients: [{ ingredientId: milk }] })).body.drink.id;
    const plain = (await owner.agent.post(`${base}/drinks`).send({ name: "Doppio", kind: "espresso" })).body.drink.id;
    const log = { beanId: bean, recipeId: shot, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 };

    const made = await owner.agent.post(`${base}/brew-logs`).send({ ...log, drinkId: latte, rating: 3, tastingNotes: "sharp", drinkRating: 5, drinkTastingNotes: " caramel " });
    expect(made.status).toBe(201);
    expect(made.body.brewLog).toMatchObject({
      rating: 3,
      tastingNotes: "sharp",
      drinkRating: 5,
      drinkTastingNotes: "caramel",
      drink: { id: latte, name: "Latte", hasIngredients: true },
    });
    const doppio = await owner.agent.post(`${base}/brew-logs`).send({ ...log, drinkId: plain });
    expect(doppio.body.brewLog.drink).toMatchObject({ hasIngredients: false });
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...log, drinkRating: 4 })).body.error).toMatch(/only for a brew made for a drink/);
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...log, drinkId: latte, drinkRating: 6 })).status).toBe(400);

    const url = `${base}/brew-logs/${made.body.brewLog.id}`;
    expect((await owner.agent.patch(url).send({ drinkId: null })).status).toBe(400); // the drink's tasting would be orphaned
    expect((await owner.agent.patch(url).send({ drinkTastingNotes: "even better" })).body.brewLog.drinkTastingNotes).toBe("even better");
    const cleared = await owner.agent.patch(url).send({ drinkId: null, drinkRating: null, drinkTastingNotes: null });
    expect(cleared.body.brewLog).toMatchObject({ drink: null, drinkRating: null, drinkTastingNotes: null, rating: 3 });
  });
});
