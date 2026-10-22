import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { newBean, newUser, newWorkspace } from "./helpers.js";

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
};

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const beansUrl = `/api/workspaces/${ws.id}/beans`;
  return { owner, ws, beansUrl };
}

describe("bean details (docs/api/beans.md §4)", () => {
  it("stores every detail and returns it on create and list", async () => {
    const { owner, beansUrl } = await setup();
    const created = await owner.agent.post(beansUrl).send({ roasterName: "Onyx", beanName: "House", ...DETAILS });
    expect(created.status).toBe(201);
    const expected = { ...DETAILS, priceCurrency: "USD" }; // uppercased
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
    });
  });

  it("clears details with null on PATCH, and blank text becomes null", async () => {
    const { owner, ws, beansUrl } = await setup();
    const id = await newBean(owner, ws.id, DETAILS);
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
    });
    expect(res.status).toBe(200);
    expect(res.body.bean).toMatchObject({ roastType: null, detailedRoastLevel: null, website: null, priceAmount: null, notes: null, decaf: false });
    // roastLevel is stored apart from the detailed level and is untouched.
    expect(res.body.bean.roastLevel).toBe("medium_dark");
  });

  it("rejects invalid details", async () => {
    const { owner, beansUrl } = await setup();
    const post = (fields: Record<string, unknown>) => owner.agent.post(beansUrl).send({ roasterName: "Onyx", beanName: "Bad", ...fields });
    for (const fields of [
      { roastType: "cold" },
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

  it("still 404s a PATCH for a bean in another workspace", async () => {
    const { owner, ws } = await setup();
    const other = await newWorkspace(owner);
    const id = await newBean(owner, other.id);
    expect((await owner.agent.patch(`/api/workspaces/${ws.id}/beans/${id}`).send({ decaf: true })).status).toBe(404);
  });

  it("publishes roast and blend details on the public menu, but not price, website or notes", async () => {
    const { owner, ws } = await setup();
    await newBean(owner, ws.id, DETAILS);
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    const [bean] = (await request(app).get(`/api/public/menu/${ws.slug}`)).body.beans;
    expect(bean).toMatchObject({ roastType: "espresso", detailedRoastLevel: "full_city_plus", roastLevel: "medium_dark", blendType: "blend", decaf: true });
    for (const key of ["website", "priceAmount", "priceCurrency", "bagWeightGrams", "notes"]) expect(bean).not.toHaveProperty(key);
  });
});
