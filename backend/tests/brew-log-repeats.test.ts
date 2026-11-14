import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { brewLogs } from "@barista/shared/schema";
import { db } from "../src/db.js";
import { newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

// docs/api/brew-logs.md, GET …/brew-logs/repeats: the newest brew of each of
// the last n different things brewed, over every brew.
describe("brew log repeats", () => {
  async function setup() {
    const owner = await newUser("owner");
    const ws = await newWorkspace(owner);
    const base = `/api/workspaces/${ws.id}`;
    // Two brewers of the same (default) method.
    const brewer = async (name: string) => (await owner.agent.post(`${base}/brewers`).send({ name })).body.brewer.id as string;
    const [chemex, kalita] = [await brewer("Chemex"), await brewer("Kalita")];
    const recipe = async (name: string, brewerId: string) =>
      (await owner.agent.post(`${base}/recipes`).send({ name, brewerId, targetDoseGrams: 20, targetWaterGrams: 320 })).body.recipe.id as string;
    const [daily, strong, kalitaDaily] = [await recipe("Daily", chemex), await recipe("Strong", chemex), await recipe("Kalita daily", kalita)];
    const drink = (await owner.agent.post(`${base}/drinks`).send({ name: "Tonic", kind: "filter" })).body.drink.id as string;
    const [kenya, kenyaNext, guji] = [
      await newBean(owner, ws.id, { roasterName: "Onyx", beanName: "Kenya", batchNumber: "1" }),
      await newBean(owner, ws.id, { roasterName: "onyx ", beanName: "Kenya", batchNumber: "2" }),
      await newBean(owner, ws.id, { roasterName: "Onyx", beanName: "Guji" }),
    ];
    // Oldest first; each a minute after the last, so the order is fixed.
    const start = Date.UTC(2026, 0, 1);
    let minute = 0;
    const brew = async (bean: string, fields: Record<string, unknown>) => {
      const id = await newBrewLog(owner, ws.id, bean, fields);
      await db.update(brewLogs).set({ timestamp: new Date(start + minute++ * 60_000) }).where(eq(brewLogs.id, id));
      return id;
    };
    const ids = {
      tonic: await brew(kenya, { drinkId: drink, recipeId: daily }),
      guji: await brew(guji, { recipeId: daily }),
      kalita: await brew(kenya, { recipeId: kalitaDaily }),
      strong: await brew(kenya, { recipeId: strong }),
      kenyaNext: await brew(kenyaNext, { recipeId: daily }),
    };
    const repeats = async (query: string) => {
      const res = await owner.agent.get(`${base}/brew-logs/repeats?${query}`);
      expect(res.status).toBe(200);
      return (res.body.brewLogs as Array<{ id: string }>).map((l) => l.id);
    };
    return { owner, ws, base, ids, repeats, brew, kenya, daily };
  }

  it("by what was made: a drink, or a plain brew per method (the default)", async () => {
    const { ids, repeats } = await setup();
    expect(await repeats("")).toEqual([ids.kenyaNext, ids.tonic]);
  });

  it("by brewer, by recipe, and by coffee (batches of one coffee are one)", async () => {
    const { ids, repeats } = await setup();
    expect(await repeats("by=brewer")).toEqual([ids.kenyaNext, ids.kalita, ids.tonic]);
    expect(await repeats("by=recipe&n=6")).toEqual([ids.kenyaNext, ids.strong, ids.kalita, ids.tonic]);
    expect(await repeats("by=coffee&n=6")).toEqual([ids.kenyaNext, ids.strong, ids.kalita, ids.guji, ids.tonic]);
  });

  it("caps at n, newest first", async () => {
    const { ids, repeats } = await setup();
    expect(await repeats("by=coffee&n=2")).toEqual([ids.kenyaNext, ids.strong]);
    expect(await repeats("by=coffee")).toHaveLength(3);
  });

  it("finds an older kind of brew behind many newer ones", async () => {
    const { ids, repeats, brew, kenya, daily } = await setup();
    for (let i = 0; i < 35; i++) await brew(kenya, { recipeId: daily });
    const found = await repeats("by=recipe");
    expect(found).toHaveLength(3);
    expect(found.slice(1)).toEqual([ids.strong, ids.kalita]);
  });

  it("rejects a bad query, and non-members", async () => {
    const { owner, base } = await setup();
    expect((await owner.agent.get(`${base}/brew-logs/repeats?by=bean`)).status).toBe(400);
    expect((await owner.agent.get(`${base}/brew-logs/repeats?n=0`)).status).toBe(400);
    expect((await owner.agent.get(`${base}/brew-logs/repeats?n=7`)).status).toBe(400);
    const stranger = await newUser("stranger");
    expect((await stranger.agent.get(`${base}/brew-logs/repeats`)).status).toBe(404);
  });
});
