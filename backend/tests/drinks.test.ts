import { describe, expect, it } from "vitest";
import { methodId, newBean, newUser, newWorkspace, type TestUser } from "./helpers.js";

// Components (§5b), drinks (§5c) and drinks on brew logs (§6).

async function setup(): Promise<{ owner: TestUser; ws: { id: string; slug: string }; base: string; v60a: string; v60b: string; shot: string }> {
  const owner = await newUser("owner");
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}`;
  const [v60, espresso] = [await methodId(owner, ws.id, "V60"), await methodId(owner, ws.id, "Espresso")];
  const recipe = async (body: Record<string, unknown>) => (await owner.agent.post(`${base}/recipes`).send(body)).body.recipe.id as string;
  const v60a = await recipe({ name: "V60 A", methodId: v60, targetDoseGrams: 15, targetWaterGrams: 250 });
  const v60b = await recipe({ name: "V60 B", methodId: v60, targetDoseGrams: 20, targetWaterGrams: 320 });
  const shot = await recipe({ name: "Classic", methodId: espresso, targetDoseGrams: 18, expectedYieldGrams: 36 });
  return { owner, ws, base, v60a, v60b, shot };
}

describe("components", () => {
  it("CRUD with types and instructions; names unique; used ones can't be deleted", async () => {
    const { owner, base, v60a } = await setup();
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

    await owner.agent.post(`${base}/drinks`).send({ name: "The Atlas", recipeIds: [v60a], components: [{ componentId: id }] });
    expect((await owner.agent.get(`${base}/components`)).body.components.find((c: { id: string }) => c.id === id).drinkCount).toBe(1);
    const refused = await owner.agent.delete(`${base}/components/${id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.drinkCount).toBe(1);
  });
});

describe("drinks", () => {
  it("recipes (one default, first by default), components in order with amount and note", async () => {
    const { owner, base, v60a, v60b } = await setup();
    const foam = (await owner.agent.post(`${base}/components`).send({ name: "Orange cold foam", componentType: "foam" })).body.component.id;
    const syrup = (await owner.agent.post(`${base}/components`).send({ name: "Vanilla", componentType: "syrup" })).body.component.id;
    const res = await owner.agent.post(`${base}/drinks`).send({
      name: "The Atlas",
      description: "V60 with orange cold foam",
      recipeIds: [v60b, v60a],
      components: [
        { componentId: syrup, amount: "1 pump" },
        { componentId: foam, amount: "40 g", note: "spooned on top" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.drink).toMatchObject({
      name: "The Atlas",
      description: "V60 with orange cold foam",
      showOnPublicMenu: true,
      defaultRecipeId: v60b,
      recipes: [
        { id: v60a, name: "V60 A", method: { name: "V60", kind: "pour_over" } },
        { id: v60b, name: "V60 B" },
      ],
      components: [
        { componentId: syrup, name: "Vanilla", componentType: "syrup", amount: "1 pump", note: null },
        { componentId: foam, name: "Orange cold foam", amount: "40 g", note: "spooned on top" },
      ],
    });
  });

  it("validates recipes, the default and components", async () => {
    const { owner, base, v60a, v60b } = await setup();
    const other = await setup();
    const post = async (body: Record<string, unknown>) => (await owner.agent.post(`${base}/drinks`).send({ name: "D", ...body })).body.error as string;
    expect(await post({ recipeIds: [] })).toMatch(/recipeIds/);
    expect(await post({ recipeIds: [v60a, v60a] })).toMatch(/at most once/);
    expect(await post({ recipeIds: [v60a], defaultRecipeId: v60b })).toMatch(/defaultRecipeId/);
    expect(await post({ recipeIds: [other.v60a] })).toMatch(/not all recipes are in this workspace/);
    const foreign = (await other.owner.agent.post(`${other.base}/components`).send({ name: "Ice" })).body.component.id;
    expect(await post({ recipeIds: [v60a], components: [{ componentId: foreign }] })).toMatch(/not a component in this workspace/);
  });

  it("PATCH keeps the default if it's still a recipe, else falls back to the first", async () => {
    const { owner, base, v60a, v60b, shot } = await setup();
    const id = (await owner.agent.post(`${base}/drinks`).send({ name: "D", recipeIds: [v60a, v60b], defaultRecipeId: v60b })).body.drink.id;
    const url = `${base}/drinks/${id}`;
    expect((await owner.agent.patch(url).send({ recipeIds: [v60b, shot] })).body.drink.defaultRecipeId).toBe(v60b);
    expect((await owner.agent.patch(url).send({ recipeIds: [shot, v60a] })).body.drink.defaultRecipeId).toBe(shot);
    expect((await owner.agent.patch(url).send({ defaultRecipeId: v60a })).body.drink.defaultRecipeId).toBe(v60a);
    expect((await owner.agent.patch(url).send({ defaultRecipeId: v60b })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ showOnPublicMenu: false, description: "" })).body.drink).toMatchObject({ showOnPublicMenu: false, description: null });
  });

  it("deleting a recipe removes it from drinks; the default moves on", async () => {
    const { owner, base, v60a, v60b } = await setup();
    const id = (await owner.agent.post(`${base}/drinks`).send({ name: "D", recipeIds: [v60a, v60b], defaultRecipeId: v60a })).body.drink.id;
    await owner.agent.delete(`${base}/recipes/${v60a}`);
    const drink = (await owner.agent.get(`${base}/drinks`)).body.drinks.find((d: { id: string }) => d.id === id);
    expect(drink.recipes.map((r: { id: string }) => r.id)).toEqual([v60b]);
    expect(drink.defaultRecipeId).toBeNull(); // cleared by the FK; editing picks a new one
    expect((await owner.agent.patch(`${base}/drinks/${id}`).send({ name: "D2" })).body.drink.defaultRecipeId).toBe(v60b);
  });
});

describe("drink categories", () => {
  it("are optional free text; listed for suggestions; the menu groups by them", async () => {
    const { owner, ws, base, v60a, shot } = await setup();
    const post = (name: string, category?: string | null, recipe = v60a) => owner.agent.post(`${base}/drinks`).send({ name, category, recipeIds: [recipe] });
    expect((await post("Oat Latte", " Espresso milk drinks ", shot)).body.drink.category).toBe("Espresso milk drinks");
    await post("Cortado", "Espresso milk drinks", shot);
    await post("The Atlas", "Specialty drinks");
    const plain = (await post("V60", "")).body.drink;
    expect(plain.category).toBeNull();
    expect((await owner.agent.get(`${base}/drinks/categories`)).body.categories).toEqual(["Espresso milk drinks", "Specialty drinks"]);
    expect((await owner.agent.patch(`${base}/drinks/${plain.id}`).send({ category: "x".repeat(101) })).status).toBe(400);

    await owner.agent.patch(base).send({ isPublicMenuEnabled: true });
    const menu = (await owner.agent.get(`/api/public/menu/${ws.slug}`)).body.drinks.map((d: { name: string; category: string | null }) => [d.category, d.name]);
    expect(menu).toEqual([
      ["Espresso milk drinks", "Cortado"],
      ["Espresso milk drinks", "Oat Latte"],
      ["Specialty drinks", "The Atlas"],
      [null, "V60"],
    ]);
  });
});

describe("drinks on brew logs", () => {
  it("a brew for a drink uses one of its recipes; deleting the drink keeps the log", async () => {
    const { owner, ws, base, v60a, v60b } = await setup();
    const bean = await newBean(owner, ws.id);
    const drink = (await owner.agent.post(`${base}/drinks`).send({ name: "The Atlas", recipeIds: [v60a] })).body.drink.id as string;
    const log = { beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };

    const ok = await owner.agent.post(`${base}/brew-logs`).send({ ...log, recipeId: v60a, drinkId: drink });
    expect(ok.status).toBe(201);
    expect(ok.body.brewLog).toMatchObject({ drinkId: drink, drink: { id: drink, name: "The Atlas" } });
    expect((await owner.agent.post(`${base}/brew-logs`).send({ ...log, recipeId: v60b, drinkId: drink })).body.error).toMatch(/drink's recipes/);
    expect((await owner.agent.patch(`${base}/brew-logs/${ok.body.brewLog.id}`).send({ recipeId: v60b })).status).toBe(400);
    expect((await owner.agent.post(`${base}/brew-logs`).send(log)).body.brewLog.drink).toBeNull();

    const other = await newWorkspace(owner);
    const foreign = (await owner.agent.post(`/api/workspaces/${other.id}/drinks`).send({ name: "X", recipeIds: [v60a] })).body;
    expect(foreign.error).toMatch(/not all recipes/); // can't even build it there with our recipe

    expect((await owner.agent.delete(`${base}/drinks/${drink}`)).status).toBe(204);
    expect((await owner.agent.get(`${base}/brew-logs/${ok.body.brewLog.id}`)).body.brewLog).toMatchObject({ drinkId: null, drink: null });
  });
});
