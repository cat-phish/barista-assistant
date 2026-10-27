import { AI_PREVIEW_QUEUE, type AiPreviewJobData } from "@barista/shared/jobs";
import type { AiRequest } from "@barista/shared/schema";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";
import { addMember, brewerId, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

// Previews (docs/api/analysis.md §8d). The real worker isn't running here:
// a stand-in answers with the job it got, so these check what the backend
// sends and how it waits.
let worker: Worker<AiPreviewJobData, AiRequest> | null = null;
let connection: Redis | null = null;
function startWorker(): void {
  connection = new Redis(process.env.REDIS_URL ?? "", { password: process.env.REDIS_PASSWORD, maxRetriesPerRequest: null });
  worker = new Worker<AiPreviewJobData, AiRequest>(AI_PREVIEW_QUEUE, async (job) => ({ sections: ["end"], system: "Preview", input: { job: job.data } }), { connection });
}
afterEach(async () => {
  await worker?.close();
  connection?.disconnect();
  worker = null;
  delete process.env.AI_PREVIEW_TIMEOUT_MS;
});

describe("previews: what would be sent, without sending it", () => {
  it("an analysis: the worker builds it for the brew", async () => {
    startWorker();
    const owner = await newUser();
    const ws = (await newWorkspace(owner)).id;
    const log = await newBrewLog(owner, ws, await newBean(owner, ws));
    const res = await owner.agent.post(`/api/brew-logs/${log}/analyze/preview`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ request: { sections: ["end"], system: "Preview", input: { job: { kind: "analysis", brewLogId: log } } } });
  });

  it("a suggestion: resolved as asking would save it, and nothing is saved", async () => {
    startWorker();
    const owner = await newUser();
    const ws = (await newWorkspace(owner)).id;
    const v60 = await brewerId(owner, ws, "V60");
    const recipe = (await owner.agent.post(`/api/workspaces/${ws}/recipes`).send({ name: "House", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
    const bean = await newBean(owner, ws);
    const base = `/api/workspaces/${ws}/parameter-suggestions`;
    const res = await owner.agent.post(`${base}/preview`).send({ beanId: bean, recipeId: recipe, batch: { doseGrams: 20, waterGrams: 333.33 } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.request.input.job).toEqual({
      kind: "suggest",
      suggestion: { beanId: bean, recipeId: recipe, brewerId: v60, grinderId: null, source: "beanRecipe", maxBrews: 5, batchDoseGrams: 20, batchWaterGrams: 333.3, batchIceGrams: null, batchYieldGrams: null },
    });
    // The same checks as asking.
    expect((await owner.agent.post(`${base}/preview`).send({ beanId: bean, source: "recipe" })).body.error).toMatch(/pick a recipe/);
  });

  it("is for who can ask; 504 when the worker doesn't answer", async () => {
    const owner = await newUser();
    const viewer = await newUser();
    const ws = (await newWorkspace(owner)).id;
    await addMember(owner, ws, viewer, "viewer");
    const bean = await newBean(owner, ws);
    const log = await newBrewLog(owner, ws, bean);
    expect((await viewer.agent.post(`/api/brew-logs/${log}/analyze/preview`)).status).toBe(403);
    expect((await viewer.agent.post(`/api/workspaces/${ws}/parameter-suggestions/preview`).send({ beanId: bean, source: "bean" })).status).toBe(403);

    process.env.AI_PREVIEW_TIMEOUT_MS = "300"; // no worker running
    const res = await owner.agent.post(`/api/brew-logs/${log}/analyze/preview`);
    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/didn't answer/);
  });
});
