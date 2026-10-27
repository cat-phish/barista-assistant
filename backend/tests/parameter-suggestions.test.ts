import { describe, expect, it } from "vitest";
import { addMember, brewerId, newBean, newUser, newWorkspace, type TestUser } from "./helpers.js";
import { eq } from "drizzle-orm";
import { parameterSuggestions } from "@barista/shared/schema";
import { db } from "../src/db.js";
import { parameterSuggestionQueue } from "../src/queue.js";

// "Suggest parameters" (docs/api/analysis.md §8b).
async function setup(): Promise<{ owner: TestUser; ws: string; bean: string; recipe: string; v60: string; base: string }> {
  const owner = await newUser("owner");
  const ws = (await newWorkspace(owner)).id;
  const v60 = await brewerId(owner, ws, "V60");
  const recipe = (await owner.agent.post(`/api/workspaces/${ws}/recipes`).send({ name: "House", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
  return { owner, ws, bean: await newBean(owner, ws), recipe, v60, base: `/api/workspaces/${ws}/parameter-suggestions` };
}

describe("parameter suggestions", () => {
  it("saves a pending request with the workspace's defaults and the recipe's brewer, and queues it", async () => {
    const { owner, bean, recipe, v60, base } = await setup();
    const res = await owner.agent.post(base).send({ beanId: bean, recipeId: recipe });
    expect(res.status).toBe(202);
    expect(res.body.suggestion).toMatchObject({ beanId: bean, recipeId: recipe, brewerId: v60, grinderId: null, source: "beanRecipe", maxBrews: 5, status: "pending", reasoning: null, requestedBy: owner.id, note: null });
    // A one-off note goes with it (docs/api/auth.md §1c).
    expect((await owner.agent.post(base).send({ beanId: bean, source: "bean", note: "For iced" })).body.suggestion).toMatchObject({ note: "For iced" });
    expect((await owner.agent.post(base).send({ beanId: bean, source: "bean", note: "x".repeat(501) })).status).toBe(400);
    const job = await parameterSuggestionQueue.getJob(`suggest-${res.body.suggestion.id}`);
    expect(job?.data).toEqual({ suggestionId: res.body.suggestion.id });
    expect(job?.opts).toMatchObject({ attempts: 3, removeOnComplete: true, removeOnFail: true });

    expect((await owner.agent.get(`${base}/${res.body.suggestion.id}`)).body.suggestion).toEqual(res.body.suggestion);
  });

  it("saves the batch as planned, which the AI keeps", async () => {
    const { owner, bean, recipe, base } = await setup();
    const res = await owner.agent.post(base).send({ beanId: bean, recipeId: recipe, batch: { doseGrams: 22.04, waterGrams: 330, iceGrams: null } });
    expect(res.status).toBe(202);
    expect(res.body.suggestion).toMatchObject({ batchDoseGrams: 22, batchWaterGrams: 330, batchIceGrams: null, batchYieldGrams: null, ratio: null });
    expect((await owner.agent.post(base).send({ beanId: bean, batch: { doseGrams: 0 } })).status).toBe(400);
    expect((await owner.agent.post(base).send({ beanId: bean, batch: { cups: 2 } })).status).toBe(400);
  });

  it("takes the source and count asked for, else the workspace's (Settings → AI)", async () => {
    const { owner, ws, bean, recipe, base } = await setup();
    expect((await owner.agent.post(base).send({ beanId: bean, recipeId: recipe, source: "recipe", maxBrews: 12 })).body.suggestion).toMatchObject({ source: "recipe", maxBrews: 12 });
    expect((await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ suggestSource: "bean", suggestMaxBrews: 3 })).status).toBe(200);
    expect((await owner.agent.post(base).send({ beanId: bean })).body.suggestion).toMatchObject({ source: "bean", maxBrews: 3, recipeId: null, brewerId: null });
    expect((await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ suggestMaxBrews: 21 })).status).toBe(400);
    expect((await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ suggestSource: "anything" })).status).toBe(400);
  });

  it("refuses a source it can't pick brews for, and things from another workspace", async () => {
    const { owner, bean, recipe, base } = await setup();
    const other = await newUser();
    const otherWs = (await newWorkspace(other)).id;
    const foreignBean = await newBean(other, otherWs);
    const foreignGrinder = (await other.agent.post(`/api/workspaces/${otherWs}/grinders`).send({ name: "C40" })).body.grinder.id as string;

    expect((await owner.agent.post(base).send({ beanId: bean, source: "recipe" })).body.error).toMatch(/pick a recipe/);
    expect((await owner.agent.post(base).send({ beanId: bean, source: "brewer" })).body.error).toMatch(/pick a brewer/);
    expect((await owner.agent.post(base).send({ beanId: foreignBean })).body.error).toMatch(/beanId/);
    expect((await owner.agent.post(base).send({ beanId: bean, recipeId: recipe, grinderId: foreignGrinder })).body.error).toMatch(/grinderId/);
    expect((await owner.agent.post(base).send({ beanId: bean, maxBrews: 0 })).status).toBe(400);
    expect((await owner.agent.post(base).send({ beanId: bean, extra: 1 })).status).toBe(400);
    expect(await parameterSuggestionQueue.getWaitingCount()).toBe(0);
  });

  it("what was sent is read on its own, once the worker saved it (docs/api/analysis.md §8c)", async () => {
    const { owner, ws, bean, base } = await setup();
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws, viewer, "viewer");
    const id = (await owner.agent.post(base).send({ beanId: bean, source: "bean" })).body.suggestion.id as string;
    expect((await owner.agent.get(`${base}/${id}`)).body.suggestion).toMatchObject({ hasRequest: false });
    expect((await owner.agent.get(`${base}/${id}/request`)).body).toEqual({ request: null });

    const sent = { sections: ["suggestCore", "end"], system: "Suggest.", input: { batch: { doseGrams: 15 } } };
    await db.update(parameterSuggestions).set({ status: "done", request: sent }).where(eq(parameterSuggestions.id, id));
    const done = (await owner.agent.get(`${base}/${id}`)).body.suggestion;
    expect(done).toMatchObject({ hasRequest: true });
    expect(done).not.toHaveProperty("request");
    expect((await viewer.agent.get(`${base}/${id}/request`)).body).toEqual({ request: sent });
    expect((await outsider.agent.get(`${base}/${id}/request`)).status).toBe(404);
  });

  it("viewers can read one but not ask; outsiders get a 404 either way", async () => {
    const { owner, ws, bean, base } = await setup();
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws, viewer, "viewer");
    const id = (await owner.agent.post(base).send({ beanId: bean, source: "bean" })).body.suggestion.id as string;

    expect((await viewer.agent.post(base).send({ beanId: bean, source: "bean" })).status).toBe(403);
    expect((await viewer.agent.get(`${base}/${id}`)).status).toBe(200);
    expect((await outsider.agent.get(`${base}/${id}`)).status).toBe(404);
    expect((await outsider.agent.post(base).send({ beanId: bean, source: "bean" })).status).toBe(404);
    // Another workspace's URL doesn't reach it either.
    const outsiderWs = (await newWorkspace(outsider)).id;
    expect((await outsider.agent.get(`/api/workspaces/${outsiderWs}/parameter-suggestions/${id}`)).status).toBe(404);
  });
});
