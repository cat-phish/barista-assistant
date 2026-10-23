import { describe, expect, it } from "vitest";
import { addMember, brewerId, newUser, newWorkspace, styleId } from "./helpers.js";

// docs/api/recipe-styles.md §5e
type Style = { id: string; kind: string; name: string; position: number; hidden: boolean; builtin: string | null; brewsLike: string };
async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/recipe-styles`;
  const list = async () => (await owner.agent.get(base)).body.styles as Style[];
  return { owner, ws, base, list };
}

describe("recipe styles", () => {
  it("a new workspace starts with each method's built-ins, by method then position", async () => {
    const { list } = await setup();
    const styles = await list();
    expect(styles.map((s) => `${s.kind}:${s.builtin}`)).toEqual([
      "filter:pour_over", "filter:immersion", "filter:hybrid", "filter:cold_brew", "filter:other",
      "espresso:standard", "espresso:soup", "espresso:other",
      "stovetop:moka", "stovetop:ibrik", "stovetop:other",
      "other:other",
    ]);
    expect(styles[0]).toMatchObject({ name: "Pour over", position: 1, hidden: false, brewsLike: "pour_over" });
  });

  it("adds a custom style that brews like one of its method's built-ins", async () => {
    const { owner, base, list } = await setup();
    const res = await owner.agent.post(base).send({ kind: "filter", name: "Inverted", brewsLike: "immersion" });
    expect(res.status).toBe(201);
    expect(res.body.style).toMatchObject({ kind: "filter", name: "Inverted", position: 6, builtin: null, brewsLike: "immersion" });
    expect((await owner.agent.post(base).send({ kind: "filter", name: "Turbo", brewsLike: "soup" })).body.error).toMatch(/brewsLike/);
    expect((await owner.agent.post(base).send({ kind: "filter", name: "inverted", brewsLike: "immersion" })).status).toBe(409);
    // The same name is fine for another method.
    expect((await owner.agent.post(base).send({ kind: "espresso", name: "Inverted", brewsLike: "standard" })).status).toBe(201);
    expect((await list()).filter((s) => s.kind === "filter").at(-1)?.name).toBe("Inverted");
  });

  it("built-ins rename and hide but always brew like themselves and can't be deleted", async () => {
    const { owner, ws, base } = await setup();
    const soup = await styleId(owner, ws.id, "espresso", "soup");
    expect((await owner.agent.patch(`${base}/${soup}`).send({ name: "Long shot", hidden: true })).body.style).toMatchObject({ name: "Long shot", hidden: true, builtin: "soup", brewsLike: "soup" });
    expect((await owner.agent.patch(`${base}/${soup}`).send({ brewsLike: "standard" })).status).toBe(400);
    expect((await owner.agent.delete(`${base}/${soup}`)).status).toBe(409);
  });

  it("a custom style can change what it brews like, within its method", async () => {
    const { owner, base } = await setup();
    const id = (await owner.agent.post(base).send({ kind: "filter", name: "Bypass", brewsLike: "pour_over" })).body.style.id;
    expect((await owner.agent.patch(`${base}/${id}`).send({ brewsLike: "hybrid" })).body.style.brewsLike).toBe("hybrid");
    expect((await owner.agent.patch(`${base}/${id}`).send({ brewsLike: "moka" })).status).toBe(400);
  });

  it("deleting a custom style clears it from recipes, counted first", async () => {
    const { owner, ws, base } = await setup();
    const id = (await owner.agent.post(base).send({ kind: "filter", name: "Inverted", brewsLike: "immersion" })).body.style.id;
    const v60 = await brewerId(owner, ws.id, "V60");
    const recipes = `/api/workspaces/${ws.id}/recipes`;
    const made = await owner.agent.post(recipes).send({ name: "Inverted V60", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250, styleId: id });
    expect(made.body.recipe.style).toMatchObject({ id, name: "Inverted", brewsLike: "immersion" });
    expect((await owner.agent.get(`${base}/${id}/usage`)).body).toEqual({ recipeCount: 1 });
    expect((await owner.agent.delete(`${base}/${id}`)).status).toBe(204);
    const after = (await owner.agent.get(recipes)).body.recipes.find((r: { id: string }) => r.id === made.body.recipe.id);
    expect(after.style).toBeNull();
  });

  it("reorders one method's styles with every id once", async () => {
    const { owner, base, list } = await setup();
    const espresso = (await list()).filter((s) => s.kind === "espresso").map((s) => s.id);
    const reversed = [...espresso].reverse();
    const res = await owner.agent.put(`${base}/order`).send({ kind: "espresso", styleIds: reversed });
    expect(res.body.styles.filter((s: Style) => s.kind === "espresso").map((s: Style) => s.id)).toEqual(reversed);
    expect((await owner.agent.put(`${base}/order`).send({ kind: "filter", styleIds: espresso })).status).toBe(400);
  });

  it("viewers read but can't change", async () => {
    const { owner, ws, base } = await setup();
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ kind: "filter", name: "Nope", brewsLike: "pour_over" })).status).toBe(403);
  });
});
