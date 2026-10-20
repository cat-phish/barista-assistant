import { describe, expect, it } from "vitest";
import { methodId, newBean, newUser, newWorkspace, type TestUser } from "./helpers.js";

// Components (§5b), drinks (§5c), drink categories (§5d), drinks on brew logs
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
  const [v60, espresso] = [await methodId(owner, ws.id, "V60"), await methodId(owner, ws.id, "Espresso")];
  const recipe = async (body: Record<string, unknown>) => (await owner.agent.post(`${base}/recipes`).send(body)).body.recipe.id as string;
  const v60a = await recipe({ name: "V60 A", methodId: v60, targetDoseGrams: 15, targetWaterGrams: 250 });
  const v60b = await recipe({ name: "V60 B", methodId: v60, targetDoseGrams: 20, targetWaterGrams: 320 });
  const shot = await recipe({ name: "Classic", methodId: espresso, targetDoseGrams: 18, expectedYieldGrams: 36 });
  return { owner, ws, base, v60, espresso, v60a, v60b, shot };
}

describe("components", () => {
  it("CRUD with types and instructions; names unique; used ones can't be deleted", async () => {
    const { owner, base, v60 } = await setup();
    const created = await owner.agent.post(`${base}/components`).send({ name: "Orange cold foam", componentType: "foam", instructions: " Infuse cream with orange peel overnight. " });
    expect(created.status).toBe(201);
    expect(created.body.component).toEqual({
      id: expect.any(String),
      name: "Orange cold foam",
      componentType: "foam",
      instructions: "Infuse cream with orange peel overnight.",
      drinkCount: 0,
    });
    const id = created.body.component.id as string;
    expect((await owner.agent.post(`${base}/components`).send({ name: "Ice" })).body.component.componentType).toBe("other");
    expect((await owner.agent.post(`${base}/components`).send({ name: "orange cold foam" })).status).toBe(409);
    expect((await owner.agent.post(`${base}/components`).send({ name: "X", componentType: "sprinkles" })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/components/${id}`).send({ instructions: null })).body.component.instructions).toBeNull();

    await owner.agent.post(`${base}/drinks`).send({ name: "The Atlas", methodId: v60, components: [{ componentId: id }] });
    expect((await owner.agent.get(`${base}/components`)).body.components.find((c: { id: string }) => c.id === id).drinkCount).toBe(1);
    const refused = await owner.agent.delete(`${base}/components/${id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.drinkCount).toBe(1);
  });
});

describe("drinks", () => {
  it("are built on a method with an optional default recipe and components in order", async () => {
    const { owner, base, v60, v60b } = await setup();
    const foam = (await owner.agent.post(`${base}/components`).send({ name: "Orange cold foam", componentType: "foam" })).body.component.id;
    const syrup = (await owner.agent.post(`${base}/components`).send({ name: "Vanilla", componentType: "syrup" })).body.component.id;
    const res = await owner.agent.post(`${base}/drinks`).send({
      name: "The Atlas",
      description: "V60 with orange cold foam",
      methodId: v60,
      defaultRecipeId: v60b,
      components: [
        { componentId: syrup, amountValue: 1, amountUnit: " pump " },
        { componentId: foam, amountValue: 40, amountUnit: "g", note: "spooned on top" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.drink).toEqual({
      id: expect.any(String),
      name: "The Atlas",
      description: "V60 with orange cold foam",
      method: { id: v60, name: "V60", kind: "pour_over" },
      category: null,
      parent: null,
      variants: [],
      showOnPublicMenu: true,
      defaultRecipeId: v60b,
      servingSize: null,
      servingUnit: null,
      components: [
        { componentId: syrup, name: "Vanilla", componentType: "syrup", amountValue: 1, amountUnit: "pump", note: null },
        { componentId: foam, name: "Orange cold foam", componentType: "foam", amountValue: 40, amountUnit: "g", note: "spooned on top" },
      ],
    });
    expect((await owner.agent.post(`${base}/drinks`).send({ name: "No default", methodId: v60 })).body.drink.defaultRecipeId).toBeNull();
  });

  it("validates the method, the default recipe's method, the category, the parent and components", async () => {
    const { owner, base, v60, v60a, shot } = await setup();
    const other = await setup();
    const post = async (body: Record<string, unknown>) => (await owner.agent.post(`${base}/drinks`).send({ name: "D", ...body })).body.error as string;
    expect(await post({})).toMatch(/methodId/);
    expect(await post({ methodId: other.v60 })).toMatch(/not a brew method in this workspace/);
    expect(await post({ methodId: v60, defaultRecipeId: shot })).toMatch(/recipe of the drink's method/); // espresso recipe for a V60 drink
    expect(await post({ methodId: v60, defaultRecipeId: other.v60a })).toMatch(/recipe of the drink's method/);
    const foreignCategory = (await other.owner.agent.post(`${other.base}/drink-categories`).send({ name: "C" })).body.category.id;
    expect(await post({ methodId: v60, categoryId: foreignCategory })).toMatch(/not a category in this workspace/);
    const foreignDrink = (await other.owner.agent.post(`${other.base}/drinks`).send({ name: "X", methodId: other.v60 })).body.drink.id;
    expect(await post({ methodId: v60, parentDrinkId: foreignDrink })).toMatch(/not a drink in this workspace/);
    const foreign = (await other.owner.agent.post(`${other.base}/components`).send({ name: "Ice" })).body.component.id;
    expect(await post({ methodId: v60, defaultRecipeId: v60a, components: [{ componentId: foreign }] })).toMatch(/not a component in this workspace/);
  });

  it("PATCH: changing the method clears a default of the old method", async () => {
    const { owner, base, v60, espresso, v60a, v60b, shot } = await setup();
    const id = (await owner.agent.post(`${base}/drinks`).send({ name: "D", methodId: v60, defaultRecipeId: v60a })).body.drink.id;
    const url = `${base}/drinks/${id}`;
    expect((await owner.agent.patch(url).send({ defaultRecipeId: v60b })).body.drink.defaultRecipeId).toBe(v60b);
    expect((await owner.agent.patch(url).send({ defaultRecipeId: shot })).status).toBe(400);
    const moved = (await owner.agent.patch(url).send({ methodId: espresso })).body.drink;
    expect(moved).toMatchObject({ method: { id: espresso, kind: "espresso" }, defaultRecipeId: null });
    expect((await owner.agent.patch(url).send({ methodId: v60, defaultRecipeId: v60a })).body.drink.defaultRecipeId).toBe(v60a);
    expect((await owner.agent.patch(url).send({ showOnPublicMenu: false, description: "" })).body.drink).toMatchObject({ showOnPublicMenu: false, description: null });
  });

  it("deleting a recipe clears it as a default", async () => {
    const { owner, base, v60, v60a } = await setup();
    const id = (await owner.agent.post(`${base}/drinks`).send({ name: "D", methodId: v60, defaultRecipeId: v60a })).body.drink.id;
    await owner.agent.delete(`${base}/recipes/${v60a}`);
    const drink = (await owner.agent.get(`${base}/drinks`)).body.drinks.find((d: { id: string }) => d.id === id);
    expect(drink.defaultRecipeId).toBeNull();
  });

  it("a brew method used by drinks can't be deleted", async () => {
    const { owner, base } = await setup();
    const chemex = (await owner.agent.post(`${base}/brew-methods`).send({ name: "Chemex" })).body.brewMethod.id;
    await owner.agent.post(`${base}/drinks`).send({ name: "Chemex tonic", methodId: chemex });
    const refused = await owner.agent.delete(`${base}/brew-methods/${chemex}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ recipeCount: 0, drinkCount: 1 });
  });
});

describe("drink sizes", () => {
  it("a default size is a number and unit together; component amounts are a value and free unit", async () => {
    const { owner, base, espresso } = await setup();
    const syrup = (await owner.agent.post(`${base}/components`).send({ name: "Vanilla", componentType: "syrup" })).body.component.id;
    const post = (body: Record<string, unknown>) => owner.agent.post(`${base}/drinks`).send({ name: "Latte", methodId: espresso, ...body });
    const ok = await post({ servingSize: 8, servingUnit: "fl_oz", components: [{ componentId: syrup, amountValue: 2.5, amountUnit: "pump" }] });
    expect(ok.status).toBe(201);
    expect(ok.body.drink).toMatchObject({ servingSize: 8, servingUnit: "fl_oz", components: [{ amountValue: 2.5, amountUnit: "pump" }] });

    expect((await post({ servingSize: 8 })).body.error).toMatch(/go together/);
    expect((await post({ servingUnit: "ml" })).body.error).toMatch(/go together/);
    expect((await post({ servingSize: 8, servingUnit: "cups" })).status).toBe(400);
    expect((await post({ servingSize: 0, servingUnit: "ml" })).status).toBe(400);
    expect((await post({ servingSize: 8.25, servingUnit: "fl_oz" })).status).toBe(400); // one decimal
    expect((await post({ components: [{ componentId: syrup, amountValue: -1 }] })).status).toBe(400);
    expect((await post({ components: [{ componentId: syrup, amount: "2 pumps" }] })).status).toBe(400); // the old field
    const toTaste = await post({ components: [{ componentId: syrup, amountUnit: "to taste" }] });
    expect(toTaste.body.drink.components[0]).toMatchObject({ amountValue: null, amountUnit: "to taste" });

    const url = `${base}/drinks/${ok.body.drink.id}`;
    expect((await owner.agent.patch(url).send({ servingSize: null })).body.error).toMatch(/go together/);
    expect((await owner.agent.patch(url).send({ servingSize: 350, servingUnit: "ml" })).body.drink).toMatchObject({ servingSize: 350, servingUnit: "ml" });
    expect((await owner.agent.patch(url).send({ servingSize: null, servingUnit: null })).body.drink.servingSize).toBeNull();
  });

  it("a brew log records the size made, only with a drink", async () => {
    const { owner, ws, base, espresso, shot } = await setup();
    const bean = await newBean(owner, ws.id);
    const latte = (await owner.agent.post(`${base}/drinks`).send({ name: "Latte", methodId: espresso, servingSize: 8, servingUnit: "fl_oz" })).body.drink.id;
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
      (await owner.agent.post(`${base}/drinks`).send({ name, methodId: espresso, defaultRecipeId: shot, parentDrinkId })).body.drink;
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
    const post = async (name: string, parentDrinkId?: string) => (await owner.agent.post(`${base}/drinks`).send({ name, methodId: espresso, parentDrinkId })).body.drink.id as string;
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

    const drink = (await owner.agent.post(`${base}/drinks`).send({ name: "Latte", methodId: espresso, categoryId: milk.id })).body.drink;
    expect(drink.category).toEqual({ id: milk.id, name: "Espresso milk drinks" });
    await owner.agent.patch(`${base}/brew-methods/${v60}`).send({ categoryId: milk.id });
    expect((await owner.agent.delete(`${url}/${milk.id}`)).status).toBe(204);
    expect((await owner.agent.get(`${base}/drinks`)).body.drinks[0].category).toBeNull();
    const methods = (await owner.agent.get(`${base}/brew-methods`)).body.brewMethods as Array<{ id: string; categoryId: string | null }>;
    expect(methods.find((m) => m.id === v60)?.categoryId).toBeNull();
    expect((await owner.agent.delete(`${url}/${milk.id}`)).status).toBe(404);
  });
});

describe("menu sections", () => {
  it("group plain methods and drinks by category order, uncategorised last", async () => {
    const { owner, ws, base, v60, espresso } = await setup();
    const category = async (name: string) => (await owner.agent.post(`${base}/drink-categories`).send({ name })).body.category.id as string;
    const brewed = await category("Brewed coffee");
    const milk = await category("Espresso milk drinks");
    await category("Empty");
    const ice = (await owner.agent.post(`${base}/components`).send({ name: "Ice", componentType: "ice" })).body.component.id;

    expect((await owner.agent.patch(`${base}/brew-methods/${v60}`).send({ showOnPublicMenu: true, categoryId: brewed, description: "Single origin" })).status).toBe(200);
    const drink = (body: Record<string, unknown>) => owner.agent.post(`${base}/drinks`).send(body).then((r) => r.body.drink.id as string);
    const latte = await drink({ name: "Latte", methodId: espresso, categoryId: milk });
    await drink({ name: "Iced Latte", methodId: espresso, categoryId: milk, parentDrinkId: latte, components: [{ componentId: ice }] });
    const secret = await drink({ name: "Secret", methodId: espresso, showOnPublicMenu: false });
    await drink({ name: "Secret riff", methodId: espresso, parentDrinkId: secret });
    await drink({ name: "Atlas", methodId: v60, categoryId: brewed });

    await owner.agent.patch(base).send({ isPublicMenuEnabled: true });
    const menu = (await owner.agent.get(`/api/public/menu/${ws.slug}`)).body;
    expect(menu.drinks).toBeUndefined();
    const item = (kind: string, name: string, method: string, extra: Record<string, unknown> = {}) => ({
      kind,
      id: expect.any(String),
      name,
      description: null,
      method,
      variantOf: null,
      components: [],
      ...extra,
    });
    expect(menu.sections).toEqual([
      { category: "Brewed coffee", items: [item("method", "V60", "V60", { description: "Single origin" }), item("drink", "Atlas", "V60")] },
      { category: "Espresso milk drinks", items: [item("drink", "Iced Latte", "Espresso", { variantOf: "Latte", components: ["Ice"] }), item("drink", "Latte", "Espresso")] },
      { category: null, items: [item("drink", "Secret riff", "Espresso")] }, // hidden parent isn't named
    ]);
  });
});

describe("drinks on brew logs", () => {
  it("a brew for a drink uses a recipe of its method; deleting the drink keeps the log", async () => {
    const { owner, ws, base, v60, v60a, v60b, shot } = await setup();
    const bean = await newBean(owner, ws.id);
    const drink = (await owner.agent.post(`${base}/drinks`).send({ name: "The Atlas", methodId: v60, defaultRecipeId: v60a })).body.drink.id as string;
    const log = { beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };

    const ok = await owner.agent.post(`${base}/brew-logs`).send({ ...log, recipeId: v60a, drinkId: drink });
    expect(ok.status).toBe(201);
    expect(ok.body.brewLog).toMatchObject({ drinkId: drink, drink: { id: drink, name: "The Atlas" } });
    // Any recipe of the method works, not just the default.
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...log, recipeId: v60b, drinkId: drink })).status).toBe(201);
    const shotLog = { beanId: bean, actualDoseGrams: 18, actualYieldGrams: 36, actualTimeSec: 28 };
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...shotLog, recipeId: shot, drinkId: drink })).body.error).toMatch(/drink's brew method/);
    expect((await owner.agent.patch(`${base}/brew-logs/${ok.body.brewLog.id}`).send({ recipeId: shot, actualWaterGrams: null, actualYieldGrams: 36 })).status).toBe(400);
    expect((await owner.agent.post(`${base}/brew-logs`).send(log)).body.brewLog.drink).toBeNull();

    expect((await owner.agent.delete(`${base}/drinks/${drink}`)).status).toBe(204);
    expect((await owner.agent.get(`${base}/brew-logs/${ok.body.brewLog.id}`)).body.brewLog).toMatchObject({ drinkId: null, drink: null });
  });
});
