import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { menuWithBeans, newBean, newUser, newWorkspace, processId, publicMenuBeans } from "./helpers.js";

const DETAILS = {
  roastType: "espresso",
  detailedRoastLevel: "full_city_plus",
  roastLevel: "medium_dark",
  blendType: "blend",
  decaf: true,
  website: "https://example.com/beans/house-blend",
  priceAmount: 21.5,
  priceCurrency: "usd",
  bagWeightGrams: 340,
  notes: "Roaster suggests 1:2 in 28 s.",
  flavorProfile: "Dark chocolate, cherry",
  originArea: "south_america",
  country: "Colombia",
  region: "Huila",
  altitudeMasl: 1950,
  roastWeightLossPercent: 14.5,
  producer: "Finca El Paraíso",
  purchaseDate: "2026-10-05",
  greenSupplier: "Covoya",
  batchNumber: "R-12",
  rating: 4,
};

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const beansUrl = `/api/workspaces/${ws.id}/beans`;
  const carbonic = await processId(owner, ws.id, "carbonic_maceration");
  return { owner, ws, beansUrl, details: { ...DETAILS, processId: carbonic } };
}

describe("bean details (docs/api/beans.md §4)", () => {
  it("stores every detail and returns it on create and list", async () => {
    const { owner, beansUrl, details } = await setup();
    const created = await owner.agent.post(beansUrl).send({ roasterName: "Onyx", beanName: "House", ...details });
    expect(created.status).toBe(201);
    const expected = { ...details, priceCurrency: "USD" }; // uppercased
    expect(created.body.bean).toMatchObject(expected);

    const list = await owner.agent.get(beansUrl);
    expect(list.body.beans[0]).toMatchObject(expected);
  });

  it("defaults to no details and decaf false", async () => {
    const { owner, ws, beansUrl } = await setup();
    await newBean(owner, ws.id);
    const [bean] = (await owner.agent.get(beansUrl)).body.beans;
    expect(bean).toMatchObject({
      roastType: null,
      detailedRoastLevel: null,
      blendType: null,
      decaf: false,
      website: null,
      priceAmount: null,
      priceCurrency: null,
      bagWeightGrams: null,
      notes: null,
      processId: null,
      flavorProfile: null,
      originArea: null,
      country: null,
      region: null,
      altitudeMasl: null,
      producer: null,
      purchaseDate: null,
      greenSupplier: null,
      batchNumber: null,
      rating: null,
    });
  });

  it("clears details with null on PATCH, and blank text becomes null", async () => {
    const { owner, ws, beansUrl, details } = await setup();
    const id = await newBean(owner, ws.id, details);
    const res = await owner.agent.patch(`${beansUrl}/${id}`).send({
      roastType: null,
      detailedRoastLevel: null,
      blendType: null,
      decaf: false,
      website: "  ",
      priceAmount: null,
      priceCurrency: null,
      bagWeightGrams: null,
      notes: "",
      processId: null,
      flavorProfile: " ",
      originArea: null,
      country: "",
      altitudeMasl: null,
      purchaseDate: null,
      rating: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.bean).toMatchObject({
      roastType: null,
      detailedRoastLevel: null,
      website: null,
      priceAmount: null,
      notes: null,
      decaf: false,
      processId: null,
      flavorProfile: null,
      originArea: null,
      country: null,
      altitudeMasl: null,
      purchaseDate: null,
      rating: null,
    });
    // Clearing the detailed level clears the roast level it set.
    expect(res.body.bean.roastLevel).toBeNull();
  });

  it("rejects invalid details", async () => {
    const { owner, beansUrl } = await setup();
    const post = (fields: Record<string, unknown>) => owner.agent.post(beansUrl).send({ roasterName: "Onyx", beanName: "Bad", ...fields });
    for (const fields of [
      { roastType: "cold" },
      { batchNumber: "x".repeat(51) },
      { detailedRoastLevel: "medium" },
      { blendType: "mix" },
      { decaf: "yes" },
      { website: "javascript:alert(1)" },
      { website: "not a url" },
      { priceAmount: 21.555, priceCurrency: "USD" },
      { priceAmount: 0, priceCurrency: "USD" },
      { priceAmount: 20, priceCurrency: "US" },
      { priceAmount: 20, priceCurrency: "us1" },
      { bagWeightGrams: 0 },
      { bagWeightGrams: 250.5 },
      { notes: "x".repeat(2001) },
      { processId: "washed" },
      { processId: randomUUID() }, // not one of this workspace's
      { originArea: "Africa" },
      { originArea: "europe" },
      { country: "x".repeat(101) },
      { altitudeMasl: -1 },
      { altitudeMasl: 9001 },
      { altitudeMasl: 1950.5 },
      { roastWeightLossPercent: 0 },
      { roastWeightLossPercent: 40.1 },
      { roastWeightLossPercent: 14.55 },
      { roastWeightLossPercent: "15" },
      { rating: 0 },
      { rating: 6 },
      { rating: 3.5 },
      { purchaseDate: "2026-13-01" },
      { purchaseDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) },
      { flavorProfile: "x".repeat(501) },
    ]) {
      expect((await post(fields)).status, JSON.stringify(fields)).toBe(400);
    }
  });

  it("needs a price's amount and currency together, also after a PATCH", async () => {
    const { owner, ws, beansUrl } = await setup();
    const post = (fields: Record<string, unknown>) => owner.agent.post(beansUrl).send({ roasterName: "Onyx", beanName: "Priced", ...fields });
    expect((await post({ priceAmount: 20 })).body.error).toMatch(/go together/);
    expect((await post({ priceCurrency: "EUR" })).status).toBe(400);

    const id = await newBean(owner, ws.id, { priceAmount: 20, priceCurrency: "EUR" });
    const bean = `${beansUrl}/${id}`;
    expect((await owner.agent.patch(bean).send({ priceCurrency: null })).status).toBe(400);
    expect((await owner.agent.patch(bean).send({ priceAmount: 24 })).body.bean).toMatchObject({ priceAmount: 24, priceCurrency: "EUR" });
    expect((await owner.agent.patch(bean).send({ priceAmount: null, priceCurrency: null })).status).toBe(200);
    expect((await owner.agent.patch(bean).send({ priceAmount: 18 })).status).toBe(400);
  });

  it("derives roastLevel from detailedRoastLevel", async () => {
    const { owner, ws, beansUrl } = await setup();
    const post = (fields: Record<string, unknown>) => owner.agent.post(beansUrl).send({ roasterName: "Onyx", beanName: "Roast", ...fields });
    expect((await post({ detailedRoastLevel: "city_plus" })).body.bean.roastLevel).toBe("medium");
    expect((await post({ detailedRoastLevel: "city_plus", roastLevel: "medium" })).status).toBe(201);
    expect((await post({ detailedRoastLevel: "city_plus", roastLevel: "dark" })).body.error).toMatch(/set by detailedRoastLevel/);
    // Without a detailed level, roastLevel can still be set alone.
    expect((await post({ roastLevel: "dark" })).body.bean).toMatchObject({ roastLevel: "dark", detailedRoastLevel: null });

    const bean = `${beansUrl}/${await newBean(owner, ws.id, { roastLevel: "light" })}`;
    // The form always sends detailedRoastLevel; null keeps an older bean's level.
    expect((await owner.agent.patch(bean).send({ detailedRoastLevel: null, beanName: "Older" })).body.bean.roastLevel).toBe("light");
    expect((await owner.agent.patch(bean).send({ roastLevel: "medium" })).body.bean.roastLevel).toBe("medium");
    expect((await owner.agent.patch(bean).send({ detailedRoastLevel: "french" })).body.bean.roastLevel).toBe("dark");
    // Once a detailed level is stored, roastLevel alone can't contradict it.
    expect((await owner.agent.patch(bean).send({ roastLevel: "light" })).status).toBe(400);
    expect((await owner.agent.patch(bean).send({ roastLevel: "dark" })).status).toBe(200);
    expect((await owner.agent.patch(bean).send({ beanName: "Renamed" })).body.bean.roastLevel).toBe("dark");
    expect((await owner.agent.patch(bean).send({ detailedRoastLevel: "half_city" })).body.bean.roastLevel).toBe("light");
    expect((await owner.agent.patch(bean).send({ detailedRoastLevel: null, roastLevel: "medium" })).body.bean).toMatchObject({ detailedRoastLevel: null, roastLevel: "medium" });
  });

  it("still 404s a PATCH for a bean in another workspace", async () => {
    const { owner, ws } = await setup();
    const other = await newWorkspace(owner);
    const id = await newBean(owner, other.id);
    expect((await owner.agent.patch(`/api/workspaces/${ws.id}/beans/${id}`).send({ decaf: true })).status).toBe(404);
  });

  it("publishes roast, blend and origin details on the public menu, but nothing private", async () => {
    const { owner, ws, details } = await setup();
    await newBean(owner, ws.id, details);
    await menuWithBeans(owner, ws.id);
    const [bean] = await publicMenuBeans(ws.slug);
    expect(bean).toMatchObject({
      roastType: "espresso",
      detailedRoastLevel: "full_city_plus",
      roastLevel: "medium_dark",
      blendType: "blend",
      decaf: true,
      process: "Carbonic Maceration", // the name, not an id
      flavorProfile: "Dark chocolate, cherry",
      originArea: "south_america",
      country: "Colombia",
      region: "Huila",
      altitudeMasl: 1950,
      producer: "Finca El Paraíso",
    });
    for (const key of ["website", "priceAmount", "priceCurrency", "bagWeightGrams", "notes", "rating", "purchaseDate", "greenSupplier", "batchNumber"]) {
      expect(bean).not.toHaveProperty(key);
    }
  });

  it("batch no.: trimmed, blank clears it, and brew logs show it with the bean", async () => {
    const { owner, ws, beansUrl } = await setup();
    const id = await newBean(owner, ws.id, { batchNumber: " 3 " });
    expect((await owner.agent.get(beansUrl)).body.beans[0].batchNumber).toBe("3");
    const log = (await owner.agent.post(`/api/workspaces/${ws.id}/brew-logs`).send({ beanId: id, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 })).body.brewLog;
    expect(log.bean).toMatchObject({ id, batchNumber: "3" });
    expect((await owner.agent.patch(`${beansUrl}/${id}`).send({ batchNumber: "" })).body.bean.batchNumber).toBeNull();
  });
});
