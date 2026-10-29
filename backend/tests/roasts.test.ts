import { describe, expect, it } from "vitest";
import { addMember, newUser, newWorkspace } from "./helpers.js";

// The roast log (docs/api/roasts.md §4f).
async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}`;
  await owner.agent.patch(`${base}/settings`).send({ homeRoasting: true, homeRoasterName: "Garage", restDays: { filter: 5, espresso: 12, omni: 9 } });
  const washed = (await owner.agent.get(`${base}/bean-processes`)).body.processes[0].id as string;
  const green = async (fields: Record<string, unknown> = {}) =>
    (await owner.agent.post(`${base}/green-coffees`).send({ name: "Ethiopia Guji", country: "Ethiopia", originArea: "africa", region: "Guji", producer: "Hambela", altitudeMasl: 2100, varieties: ["74110"], species: ["arabica"], processId: washed, supplier: "Sweet Maria's", priceAmount: 20, priceCurrency: "USD", weightBoughtGrams: 1000, ...fields })).body.greenCoffee.id as string;
  const machine = (await owner.agent.post(`${base}/roasting-machines`).send({ name: "Nano 7" })).body.machine.id as string;
  const roast = (body: Record<string, unknown>) => owner.agent.post(`${base}/roasts`).send(body);
  const greenOf = async (id: string) => (await owner.agent.get(`${base}/green-coffees`)).body.greenCoffees.find((g: { id: string }) => g.id === id);
  const beanOf = async (id: string) => (await owner.agent.get(`${base}/beans`)).body.beans.find((b: { id: string }) => b.id === id);
  return { owner, ws, base, green, machine, roast, greenOf, beanOf, washed };
}

describe("roasts", () => {
  it("saving one creates its bean and takes the green weight off the stock", async () => {
    const { base, green, machine, roast, greenOf, beanOf, washed } = await setup();
    const guji = await green();
    const res = await roast({
      greenCoffeeId: guji,
      machineId: machine,
      roastedAt: "2026-10-20T23:30:00-07:00",
      utcOffsetMinutes: -420,
      greenGrams: 120,
      roastedGrams: 102,
      roastType: "filter",
      detailedRoastLevel: "city_plus",
      chargeTempC: 210.5,
      dropTempC: 205,
      firstCrackSec: 450,
      totalSec: 560,
      notes: " Even ",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const r = res.body.roast;
    expect(r).toMatchObject({
      greenCoffee: { id: guji, name: "Ethiopia Guji" },
      machine: { id: machine, name: "Nano 7" },
      batchNumber: "1",
      greenStockTakenGrams: 120,
      roastLevel: "medium", // city_plus
      restDays: 5, // the workspace's for filter
      notes: "Even",
    });
    expect((await greenOf(guji)).weightLeftGrams).toBe(880);

    const bean = await beanOf(r.beanId);
    expect(bean).toMatchObject({
      roasterName: "Garage",
      beanName: "Ethiopia Guji",
      processId: washed,
      originArea: "africa",
      country: "Ethiopia",
      region: "Guji",
      producer: "Hambela",
      altitudeMasl: 2100,
      varieties: ["74110"],
      species: ["arabica"],
      greenSupplier: "Sweet Maria's",
      roastDate: "2026-10-20T00:00:00.000Z", // the local date, not UTC's 21st
      roastType: "filter",
      detailedRoastLevel: "city_plus",
      roastLevel: "medium",
      roastWeightLossPercent: 15,
      inventoryWeightGrams: 102,
      bagWeightGrams: 102,
      priceAmount: 2.4, // 120 g of 1000 g for 20
      priceCurrency: "USD",
      batchNumber: "1",
    });

    // The next one is batch 2; an unknown roast type rests like omni.
    const second = (await roast({ greenCoffeeId: guji, greenGrams: 100, roastedGrams: 85 })).body.roast;
    expect(second).toMatchObject({ batchNumber: "2", restDays: 9, machine: null, roastType: null });
    expect((await (await newUser()).agent.get(`${base}/roasts`)).status).toBe(404); // not a member
  });

  it("lists newest first; takes no more stock than is left", async () => {
    const { owner, base, green, roast, greenOf } = await setup();
    const small = await green({ name: "Small", weightBoughtGrams: 100 });
    const a = (await roast({ greenCoffeeId: small, greenGrams: 80, roastedGrams: 68, roastedAt: "2026-10-01T10:00:00Z" })).body.roast;
    const b = (await roast({ greenCoffeeId: small, greenGrams: 80, roastedGrams: 68, roastedAt: "2026-10-05T10:00:00Z" })).body.roast;
    expect(b.greenStockTakenGrams).toBe(20);
    expect((await greenOf(small)).weightLeftGrams).toBe(0);
    expect((await owner.agent.get(`${base}/roasts`)).body.roasts.map((r: { id: string }) => r.id)).toEqual([b.id, a.id]);
    // Deleting gives back what it took, not more.
    expect((await owner.agent.delete(`${base}/roasts/${b.id}`)).status).toBe(204);
    expect((await greenOf(small)).weightLeftGrams).toBe(20);
    expect((await owner.agent.get(`${base}/roasts/${b.id}`)).status).toBe(404);
  });

  it("refuses weights that don't add up, first crack after the drop, and other workspaces' coffee", async () => {
    const { green, roast } = await setup();
    const guji = await green();
    expect((await roast({ greenCoffeeId: guji, greenGrams: 100, roastedGrams: 100 })).body.error).toMatch(/roastedGrams/);
    expect((await roast({ greenCoffeeId: guji, greenGrams: 100, roastedGrams: 55 })).body.error).toMatch(/40%/);
    expect((await roast({ greenCoffeeId: guji, greenGrams: 100, roastedGrams: 85, firstCrackSec: 600, totalSec: 540 })).body.error).toMatch(/firstCrackSec/);
    expect((await roast({ greenCoffeeId: guji, greenGrams: 100, roastedGrams: 85, detailedRoastLevel: "city", roastLevel: "dark" })).status).toBe(400);
    expect((await roast({ greenCoffeeId: guji, greenGrams: 100, roastedGrams: 85, roastedAt: "2099-01-01T00:00:00Z" })).status).toBe(400);
    expect((await roast({ greenGrams: 100, roastedGrams: 85 })).status).toBe(400);
    const theirs = await setup();
    const foreignGreen = await theirs.green();
    expect((await roast({ greenCoffeeId: foreignGreen, greenGrams: 100, roastedGrams: 85 })).body.error).toMatch(/greenCoffeeId/);
    expect((await roast({ greenCoffeeId: guji, machineId: theirs.machine, greenGrams: 100, roastedGrams: 85 })).body.error).toMatch(/machineId/);
  });

  it("editing keeps the bean in step and moves the stock", async () => {
    const { owner, base, green, roast, greenOf, beanOf } = await setup();
    const guji = await green();
    const kenya = await green({ name: "Kenya Nyeri", country: "Kenya", region: "Nyeri", priceAmount: null, priceCurrency: null });
    const r = (await roast({ greenCoffeeId: guji, greenGrams: 100, roastedGrams: 85, roastedAt: "2026-10-20T10:00:00Z" })).body.roast;
    const url = `${base}/roasts/${r.id}`;
    // The bean was brewed from: its stock moves by the change, not reset.
    await owner.agent.patch(`${base}/beans/${r.beanId}`).send({ inventoryWeightGrams: 70 });

    const more = await owner.agent.patch(url).send({ greenGrams: 150, roastedGrams: 126, detailedRoastLevel: "full_city", roastType: "espresso" });
    expect(more.status, JSON.stringify(more.body)).toBe(200);
    expect(more.body.roast).toMatchObject({ greenStockTakenGrams: 150, roastLevel: "medium" });
    expect((await greenOf(guji)).weightLeftGrams).toBe(850);
    expect(await beanOf(r.beanId)).toMatchObject({ inventoryWeightGrams: 111, bagWeightGrams: 126, roastWeightLossPercent: 16, priceAmount: 3, detailedRoastLevel: "full_city", roastType: "espresso" });

    // Another green coffee: the stock goes back to the first, and the bean is that coffee now.
    const moved = await owner.agent.patch(url).send({ greenCoffeeId: kenya, roastedAt: "2026-10-22T10:00:00Z" });
    expect(moved.body.roast.greenCoffee).toEqual({ id: kenya, name: "Kenya Nyeri" });
    expect((await greenOf(guji)).weightLeftGrams).toBe(1000);
    expect((await greenOf(kenya)).weightLeftGrams).toBe(850);
    expect(await beanOf(r.beanId)).toMatchObject({ beanName: "Kenya Nyeri", country: "Kenya", region: "Nyeri", priceAmount: null, roastDate: "2026-10-22T00:00:00.000Z" });

    expect((await owner.agent.patch(url).send({ roastedGrams: 160 })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ firstCrackSec: 500, totalSec: 400 })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/roasts/00000000-0000-4000-8000-000000000000`).send({ notes: "x" })).status).toBe(404);
  });

  it("deleting keeps its bean; deleting what it used unlinks it; usage counts roasts", async () => {
    const { owner, base, green, machine, roast, beanOf } = await setup();
    const guji = await green();
    const r = (await roast({ greenCoffeeId: guji, machineId: machine, greenGrams: 100, roastedGrams: 85 })).body.roast;
    expect((await owner.agent.get(`${base}/roasting-machines/${machine}/usage`)).body).toEqual({ roastCount: 1 });
    expect((await owner.agent.get(`${base}/green-coffees/${guji}/usage`)).body).toEqual({ roastCount: 1 });
    await owner.agent.delete(`${base}/roasting-machines/${machine}`);
    await owner.agent.delete(`${base}/green-coffees/${guji}`);
    const kept = (await owner.agent.get(`${base}/roasts/${r.id}`)).body.roast;
    expect(kept).toMatchObject({ machine: null, greenCoffee: null, greenCoffeeId: null, beanId: r.beanId });
    // Editing still works without its green coffee.
    expect((await owner.agent.patch(`${base}/roasts/${r.id}`).send({ greenGrams: 110 })).body.roast.greenStockTakenGrams).toBe(0);

    await owner.agent.delete(`${base}/beans/${r.beanId}`);
    expect((await owner.agent.get(`${base}/roasts/${r.id}`)).body.roast.beanId).toBeNull();
    const second = (await roast({ greenCoffeeId: await green({ name: "Other" }), greenGrams: 100, roastedGrams: 85 })).body.roast;
    expect((await owner.agent.delete(`${base}/roasts/${second.id}`)).status).toBe(204);
    expect(await beanOf(second.beanId)).toBeDefined();
  });

  it("viewers read only", async () => {
    const { owner, ws, base, green, roast } = await setup();
    const r = (await roast({ greenCoffeeId: await green(), greenGrams: 100, roastedGrams: 85 })).body.roast;
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(`${base}/roasts`)).body.roasts).toHaveLength(1);
    expect((await viewer.agent.post(`${base}/roasts`).send({ greenCoffeeId: r.greenCoffeeId, greenGrams: 10, roastedGrams: 9 })).status).toBe(403);
    expect((await viewer.agent.patch(`${base}/roasts/${r.id}`).send({ notes: "x" })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/roasts/${r.id}`)).status).toBe(403);
  });
});
