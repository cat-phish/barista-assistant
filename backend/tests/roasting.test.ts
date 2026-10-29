import { describe, expect, it } from "vitest";
import { addMember, newUser, newWorkspace } from "./helpers.js";

// Home roasting (docs/api/roasting-machines.md §3f, docs/api/green-coffees.md §4e).
async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}`;
  return { owner, ws, machines: `${base}/roasting-machines`, greens: `${base}/green-coffees`, base };
}

describe("roasting machines", () => {
  it("create, list (active first), rename; names unique per workspace", async () => {
    const { owner, machines } = await setup();
    const nano = (await owner.agent.post(machines).send({ name: "Nano 7", capacityGrams: 120 })).body.machine;
    expect(nano).toMatchObject({ name: "Nano 7", capacityGrams: 120, notes: null, archivedAt: null });
    expect(typeof nano.createdAt).toBe("string");
    const res = await owner.agent.post(machines).send({ name: "  Behmor ", notes: "  in the garage " });
    expect(res.body.machine).toMatchObject({ name: "Behmor", notes: "in the garage", capacityGrams: null });
    expect((await owner.agent.post(machines).send({ name: "nano 7" })).status).toBe(409);
    expect((await owner.agent.post(machines).send({ name: "Big", capacityGrams: 0 })).status).toBe(400);

    await owner.agent.patch(`${machines}/${nano.id}`).send({ archived: true });
    const list = await owner.agent.get(machines);
    expect(list.body.machines.map((m: { name: string }) => m.name)).toEqual(["Behmor", "Nano 7"]);

    const renamed = await owner.agent.patch(`${machines}/${nano.id}`).send({ name: "Nano 7e", capacityGrams: null, archived: false });
    expect(renamed.body.machine).toMatchObject({ name: "Nano 7e", capacityGrams: null, archivedAt: null });
    expect((await owner.agent.patch(`${machines}/${nano.id}`).send({ name: "Behmor" })).status).toBe(409);
    expect((await owner.agent.patch(`${machines}/${nano.id}`).send({})).status).toBe(400);
  });

  it("usage is empty until roasts are logged; delete removes it", async () => {
    const { owner, machines } = await setup();
    const id = (await owner.agent.post(machines).send({ name: "Gene Cafe" })).body.machine.id;
    expect((await owner.agent.get(`${machines}/${id}/usage`)).body).toEqual({ roastCount: 0 });
    expect((await owner.agent.delete(`${machines}/${id}`)).status).toBe(204);
    expect((await owner.agent.delete(`${machines}/${id}`)).status).toBe(404);
    expect((await owner.agent.get(`${machines}/${id}/usage`)).status).toBe(404);
  });

  it("viewers read only; other workspaces can't see or change them", async () => {
    const { owner, ws, machines } = await setup();
    const id = (await owner.agent.post(machines).send({ name: "Shared" })).body.machine.id;
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(machines)).status).toBe(200);
    expect((await viewer.agent.post(machines).send({ name: "x" })).status).toBe(403);
    expect((await viewer.agent.patch(`${machines}/${id}`).send({ archived: true })).status).toBe(403);
    expect((await viewer.agent.delete(`${machines}/${id}`)).status).toBe(403);

    const outsider = await newUser();
    expect((await outsider.agent.get(machines)).status).toBe(404);
    const theirs = await newWorkspace(outsider);
    const url = `/api/workspaces/${theirs.id}/roasting-machines/${id}`;
    expect((await outsider.agent.patch(url).send({ name: "Mine" })).status).toBe(404);
    expect((await outsider.agent.delete(url)).status).toBe(404);
  });
});

describe("green coffees", () => {
  it("create with origin, stock and price; stock left starts at what was bought", async () => {
    const { owner, greens } = await setup();
    const res = await owner.agent.post(greens).send({
      name: " Ethiopia Guji Hambela ",
      originArea: "africa",
      country: "Ethiopia",
      region: "Guji",
      producer: "Hambela Estate",
      altitudeMasl: 2100,
      varieties: ["74110", "74112", "74110"],
      species: ["arabica"],
      supplier: "Sweet Maria's",
      lot: "",
      priceAmount: 42.5,
      priceCurrency: "usd",
      weightBoughtGrams: 2270,
      lowStockGrams: 500,
      purchaseDate: "2026-10-01",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.greenCoffee).toMatchObject({
      name: "Ethiopia Guji Hambela",
      varieties: ["74110", "74112"],
      species: ["arabica"],
      lot: null,
      priceAmount: 42.5,
      priceCurrency: "USD",
      weightBoughtGrams: 2270,
      weightLeftGrams: 2270,
      lowStockGrams: 500,
      purchaseDate: "2026-10-01",
      archivedAt: null,
    });
    const bare = (await owner.agent.post(greens).send({ name: "Mystery" })).body.greenCoffee;
    expect(bare).toMatchObject({ weightBoughtGrams: null, weightLeftGrams: 0, varieties: null, processId: null });
    const partly = (await owner.agent.post(greens).send({ name: "Opened", weightBoughtGrams: 1000, weightLeftGrams: 300 })).body.greenCoffee;
    expect(partly.weightLeftGrams).toBe(300);
    expect((await owner.agent.post(greens).send({ name: "ethiopia guji hambela" })).status).toBe(409);
  });

  it("refuses a price without its currency, a future purchase and another workspace's process", async () => {
    const { owner, base, greens } = await setup();
    expect((await owner.agent.post(greens).send({ name: "A", priceAmount: 10 })).body.error).toMatch(/priceCurrency/);
    expect((await owner.agent.post(greens).send({ name: "A", purchaseDate: "2099-01-01" })).status).toBe(400);
    expect((await owner.agent.post(greens).send({ name: "A", weightLeftGrams: -1 })).status).toBe(400);

    const mine = (await owner.agent.post(`${base}/bean-processes`).send({ name: "Koji" })).body.process.id;
    const other = await newWorkspace(owner);
    const foreign = (await owner.agent.post(`/api/workspaces/${other.id}/bean-processes`).send({ name: "Koji" })).body.process.id;
    expect((await owner.agent.post(greens).send({ name: "A", processId: foreign })).body.error).toMatch(/processId/);
    const created = (await owner.agent.post(greens).send({ name: "A", processId: mine, priceAmount: 10, priceCurrency: "EUR" })).body.greenCoffee;
    expect(created.processId).toBe(mine);
    const url = `${greens}/${created.id}`;
    expect((await owner.agent.patch(url).send({ processId: foreign })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ priceCurrency: null })).status).toBe(400);
    expect((await owner.agent.patch(url).send({ priceAmount: null, priceCurrency: null })).body.greenCoffee).toMatchObject({ priceAmount: null, priceCurrency: null });

    // Deleting the process leaves the green coffee without one.
    await owner.agent.delete(`${base}/bean-processes/${mine}`);
    expect((await owner.agent.get(greens)).body.greenCoffees[0].processId).toBeNull();
  });

  it("edit stock, archive (keeping the first date) and restore; active ones list first", async () => {
    const { owner, greens } = await setup();
    const a = (await owner.agent.post(greens).send({ name: "A Kenya", weightBoughtGrams: 1000 })).body.greenCoffee.id;
    await owner.agent.post(greens).send({ name: "B Brazil" });
    const left = await owner.agent.patch(`${greens}/${a}`).send({ weightLeftGrams: 0, notes: "used up" });
    expect(left.body.greenCoffee).toMatchObject({ weightLeftGrams: 0, weightBoughtGrams: 1000, notes: "used up" });
    const first = (await owner.agent.patch(`${greens}/${a}`).send({ archived: true })).body.greenCoffee.archivedAt;
    expect(first).toEqual(expect.any(String));
    expect((await owner.agent.patch(`${greens}/${a}`).send({ archived: true })).body.greenCoffee.archivedAt).toBe(first);
    expect((await owner.agent.get(greens)).body.greenCoffees.map((g: { name: string }) => g.name)).toEqual(["B Brazil", "A Kenya"]);
    expect((await owner.agent.patch(`${greens}/${a}`).send({ archived: false })).body.greenCoffee.archivedAt).toBeNull();
    expect((await owner.agent.patch(`${greens}/${a}`).send({ name: "B Brazil" })).status).toBe(409);

    expect((await owner.agent.get(`${greens}/${a}/usage`)).body).toEqual({ roastCount: 0 });
    expect((await owner.agent.delete(`${greens}/${a}`)).status).toBe(204);
    expect((await owner.agent.patch(`${greens}/${a}`).send({ notes: "x" })).status).toBe(404);
  });

  it("viewers read only; outsiders get 404", async () => {
    const { owner, ws, greens } = await setup();
    const id = (await owner.agent.post(greens).send({ name: "Shared" })).body.greenCoffee.id;
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(greens)).body.greenCoffees).toHaveLength(1);
    expect((await viewer.agent.post(greens).send({ name: "x" })).status).toBe(403);
    expect((await viewer.agent.patch(`${greens}/${id}`).send({ weightLeftGrams: 1 })).status).toBe(403);
    expect((await (await newUser()).agent.get(greens)).status).toBe(404);
  });
});
