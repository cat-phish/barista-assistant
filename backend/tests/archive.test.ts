import { describe, expect, it } from "vitest";
import { addMember, brewerId, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

// Archiving recipes (§5), drinks (§5c) and ingredients (§5b), like beans (§4).

async function setup() {
  const owner = await newUser("owner");
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}`;
  const v60 = await brewerId(owner, ws.id, "V60");
  const recipe = (await owner.agent.post(`${base}/recipes`).send({ name: "House V60", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
  const ingredient = (await owner.agent.post(`${base}/ingredients`).send({ name: "Vanilla syrup", ingredientType: "syrup" })).body.ingredient.id as string;
  const drink = (await owner.agent.post(`${base}/drinks`).send({ name: "The Atlas", kind: "filter", defaultRecipeId: recipe, ingredients: [{ ingredientId: ingredient }] })).body.drink.id as string;
  return { owner, ws, base, recipe, ingredient, drink };
}

const things = [
  { what: "recipes", key: "recipe", id: "recipe" },
  { what: "drinks", key: "drink", id: "drink" },
  { what: "ingredients", key: "ingredient", id: "ingredient" },
] as const;

describe("archiving recipes, drinks and ingredients", () => {
  for (const { what, key, id } of things) {
    it(`${what}: archive keeps the first date, shows in the list, restore clears it`, async () => {
      const s = await setup();
      const url = `${s.base}/${what}/${s[id]}`;
      expect((await s.owner.agent.get(url.replace(/\/[^/]+$/, ""))).body[what][0].archivedAt).toBeNull();

      const first = (await s.owner.agent.patch(url).send({ archived: true })).body[key].archivedAt;
      expect(first).toEqual(expect.any(String));
      await new Promise((r) => setTimeout(r, 1100));
      expect((await s.owner.agent.patch(url).send({ archived: true })).body[key].archivedAt).toBe(first);
      const list = (await s.owner.agent.get(`${s.base}/${what}`)).body[what] as Array<{ id: string; archivedAt: string | null }>;
      expect(list.find((x) => x.id === s[id])?.archivedAt).toBe(first);

      expect((await s.owner.agent.patch(url).send({ archived: false })).body[key].archivedAt).toBeNull();
      expect((await s.owner.agent.patch(url).send({ archived: "yes" })).status).toBe(400);
    });
  }

  it("archive goes with other changes, and viewers can't archive", async () => {
    const s = await setup();
    const res = await s.owner.agent.patch(`${s.base}/recipes/${s.recipe}`).send({ name: "Old V60", archived: true });
    expect(res.body.recipe).toMatchObject({ name: "Old V60", archivedAt: expect.any(String) });
    const viewer = await newUser();
    await addMember(s.owner, s.ws.id, viewer, "viewer");
    expect((await viewer.agent.patch(`${s.base}/drinks/${s.drink}`).send({ archived: true })).status).toBe(403);
  });

  it("archived ones stay usable: brews, a drink's default recipe and its ingredients keep them", async () => {
    const s = await setup();
    for (const { what, id } of things) await s.owner.agent.patch(`${s.base}/${what}/${s[id]}`).send({ archived: true });
    const drink = (await s.owner.agent.get(`${s.base}/drinks`)).body.drinks[0];
    expect(drink.defaultRecipeId).toBe(s.recipe);
    expect(drink.ingredients.map((i: { ingredientId: string }) => i.ingredientId)).toEqual([s.ingredient]);
    // Logging an old brew afterwards still works with them.
    await newBrewLog(s.owner, s.ws.id, await newBean(s.owner, s.ws.id), { recipeId: s.recipe, drinkId: s.drink });
  });
});
