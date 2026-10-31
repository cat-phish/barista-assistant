import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { beanReviewQueue } from "../src/queue.js";
import { brewerId, newBean, newBrewLog, newUser, newWorkspace, addMember, type TestUser } from "./helpers.js";

async function setup(): Promise<{ owner: TestUser; ws: string; bean: string; recipe: string; v60: string; summary: string }> {
  const owner = await newUser("owner");
  const ws = (await newWorkspace(owner)).id;
  const v60 = await brewerId(owner, ws, "V60");
  const recipe = (await owner.agent.post(`/api/workspaces/${ws}/recipes`).send({ name: "House", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
  const bean = await newBean(owner, ws);
  return { owner, ws, bean, recipe, v60, summary: `/api/workspaces/${ws}/beans/${bean}/brew-summary` };
}

describe("a bean's brew summary (docs/api/beans.md §4)", () => {
  it("is empty before any brews", async () => {
    const { owner, summary } = await setup();
    expect((await owner.agent.get(summary)).body).toEqual({ brewCount: 0, ratedCount: 0, averageRating: null, brewers: [] });
  });

  it("averages the coffee's rating over rated brews, by brewer, without steeping ones", async () => {
    const { owner, ws, bean, recipe, v60, summary } = await setup();
    await newBrewLog(owner, ws, bean, { recipeId: recipe, rating: 4 });
    await newBrewLog(owner, ws, bean, { recipeId: recipe, rating: 3.5 });
    await newBrewLog(owner, ws, bean, { recipeId: recipe, rating: 3.5 });
    await newBrewLog(owner, ws, bean, { recipeId: recipe }); // unrated
    await newBrewLog(owner, ws, bean, { rating: 1 }); // no brewer
    await newBrewLog(owner, ws, bean, { steeping: true, steepMinHours: 12, steepMaxHours: 18 });
    await newBrewLog(owner, ws, await newBean(owner, ws), { recipeId: recipe, rating: 1 }); // another bean
    const res = await owner.agent.get(summary);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ brewCount: 5, ratedCount: 4, averageRating: 3, brewers: [{ id: v60, name: "V60", brewCount: 4 }] });
  });

  it("rounds the average to 2 decimals", async () => {
    const { owner, ws, bean, summary } = await setup();
    for (const rating of [4, 4, 3.5]) await newBrewLog(owner, ws, bean, { rating });
    expect((await owner.agent.get(summary)).body.averageRating).toBe(3.83);
  });

  it("any member can read it; another workspace's bean is a 404", async () => {
    const { owner, ws, summary } = await setup();
    const viewer = await newUser("viewer");
    await addMember(owner, ws, viewer, "viewer");
    expect((await viewer.agent.get(summary)).status).toBe(200);
    const other = await newUser("other");
    const theirs = (await newWorkspace(other)).id;
    expect((await other.agent.get(`/api/workspaces/${theirs}/beans/${summary.split("/")[5]}/brew-summary`)).status).toBe(404);
  });
});

describe("bean review defaults (docs/api/workspaces.md §2)", () => {
  it("keeps valid defaults and refuses bad ones", async () => {
    const { owner, ws, v60 } = await setup();
    const settings = `/api/workspaces/${ws}/settings`;
    const ok = await owner.agent.patch(settings).send({ beanReviews: false, beanReviewMaxBrews: 30, beanReviewRatedOnly: false, beanReviewBrewers: [v60] });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ beanReviews: false, beanReviewMaxBrews: 30, beanReviewRatedOnly: false, beanReviewBrewers: [v60] });
    expect((await owner.agent.patch(settings).send({ beanReviewBrewers: "all" })).body.settings.beanReviewBrewers).toBe("all");
    for (const bad of [{ beanReviewMaxBrews: 0 }, { beanReviewMaxBrews: 31 }, { beanReviewBrewers: "some" }, { beanReviewBrewers: [v60, v60] }, { beanReviewBrewers: ["x"] }]) {
      expect((await owner.agent.patch(settings).send(bad)).status).toBe(400);
    }
  });
});

describe("a bean's review draft (docs/api/analysis.md §8e)", () => {
  const body = { brewerIds: null, maxBrews: 5, ratedOnly: true };
  const preview = (over: object = {}) => ({ ...body, ...over });
  // The worker isn't running here: the job is checked as queued.
  beforeEach(async () => {
    vi.restoreAllMocks();
    await beanReviewQueue.obliterate({ force: true });
  });

  it("refuses a viewer, a stranger's bean, a bad body and a foreign brewer", async () => {
    const { owner, ws, bean } = await setup();
    await newBrewLog(owner, ws, bean, { rating: 4 });
    const url = `/api/workspaces/${ws}/beans/${bean}/review-draft/preview`;
    const viewer = await newUser("viewer");
    await addMember(owner, ws, viewer, "viewer");
    expect((await viewer.agent.post(url).send(body)).status).toBe(403);
    expect((await owner.agent.post(`/api/workspaces/${ws}/beans/${await newBean(owner, (await newWorkspace(owner)).id)}/review-draft/preview`).send(body)).status).toBe(404);
    expect((await owner.agent.post(url).send({ maxBrews: 31 })).status).toBe(400);
    expect((await owner.agent.post(url).send({ brewerIds: [] })).status).toBe(400);
    const theirs = await brewerId(owner, (await newWorkspace(owner)).id, "V60");
    expect((await owner.agent.post(url).send({ brewerIds: [theirs] })).status).toBe(400);
  });

  it("is a 403 when the workspace turned it off", async () => {
    const { owner, ws, bean } = await setup();
    await newBrewLog(owner, ws, bean, { rating: 4 });
    await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ beanReviews: false });
    expect((await owner.agent.post(`/api/workspaces/${ws}/beans/${bean}/review-draft`).send(body)).status).toBe(403);
  });

  it("is a 409 when no brews match, and unrated brews stay out when the workspace hides them", async () => {
    const { owner, ws, bean } = await setup();
    const url = `/api/workspaces/${ws}/beans/${bean}/review-draft/preview`;
    expect((await owner.agent.post(url).send(preview({ ratedOnly: false }))).status).toBe(409);
    await newBrewLog(owner, ws, bean); // unrated
    expect((await owner.agent.post(url).send(preview({ ratedOnly: true }))).status).toBe(409);
    await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ aiHidden: ["unratedHistory"] });
    expect((await owner.agent.post(url).send(preview({ ratedOnly: false }))).status).toBe(409);
  });

  it("queues what was asked, the workspace's defaults filling the rest", async () => {
    const { owner, ws, bean, recipe, v60 } = await setup();
    await newBrewLog(owner, ws, bean, { recipeId: recipe, rating: 4 });
    await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ beanReviewMaxBrews: 7, beanReviewRatedOnly: false, beanReviewBrewers: [v60] });
    const add = vi.spyOn(beanReviewQueue, "add").mockRejectedValue(new Error("stop here"));
    const url = `/api/workspaces/${ws}/beans/${bean}/review-draft`;
    expect((await owner.agent.post(url).send({ note: "  with milk " })).status).toBe(503);
    expect(add.mock.calls[0]![1]).toEqual({ beanId: bean, brewerIds: [v60], maxBrews: 7, ratedOnly: false, requestedBy: owner.id, note: "with milk" });
  });

  it("a saved brewer choice that doesn't apply falls back to every brew", async () => {
    const { owner, ws, bean } = await setup();
    await newBrewLog(owner, ws, bean, { rating: 4 }); // no brewer
    await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ beanReviewBrewers: [randomUUID()] });
    const add = vi.spyOn(beanReviewQueue, "add").mockRejectedValue(new Error("stop here"));
    await owner.agent.post(`/api/workspaces/${ws}/beans/${bean}/review-draft`).send({});
    expect(add.mock.calls[0]![1]).toMatchObject({ brewerIds: null });
  });
});
