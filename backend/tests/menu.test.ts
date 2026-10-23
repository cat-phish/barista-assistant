import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { addMember, brewerId, menuAdd, menuSection, newBean, newUser, newWorkspace } from "./helpers.js";

interface Item {
  id: string;
  itemType: string;
  name: string | null;
  price: number | null;
  available: boolean;
  source: { name: string; archived: boolean } | null;
}
interface Section {
  id: string;
  name: string;
  items: Item[];
}

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/menu`;
  const drink = async (name: string, extra: Record<string, unknown> = {}) =>
    (await owner.agent.post(`/api/workspaces/${ws.id}/drinks`).send({ name, kind: "espresso", ...extra })).body.drink.id as string;
  const get = async () => (await owner.agent.get(base)).body as { currency: string | null; sections: Section[] };
  return { owner, ws, base, drink, get };
}

describe("menu builder (docs/api/menu.md §7b)", () => {
  it("starts empty, and adds sections last", async () => {
    const { owner, ws, base, get } = await setup();
    expect(await get()).toEqual({ currency: null, sections: [] });
    await menuSection(owner, ws.id, "Espresso");
    const res = await owner.agent.post(`${base}/sections`).send({ name: "Pour over", description: "Brewed to order" });
    expect(res.status).toBe(201);
    expect(res.body.sections.map((s: Section) => s.name)).toEqual(["Espresso", "Pour over"]);
    expect((await owner.agent.post(`${base}/sections`).send({ name: "espresso" })).status).toBe(409); // case-insensitive
  });

  it("places drinks, brewers and the beans block, with overrides", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const section = await menuSection(owner, ws.id, "Espresso");
    const latte = await drink("Latte", { description: "Double shot, steamed milk" });
    const espresso = await brewerId(owner, ws.id, "Espresso");
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: latte });
    await menuAdd(owner, ws.id, section, { itemType: "brewer", brewerId: espresso, name: "Espresso shot" });
    await menuAdd(owner, ws.id, section, { itemType: "beans" });
    const [s] = (await get()).sections;
    expect(s!.items).toMatchObject([
      { itemType: "drink", name: null, source: { name: "Latte", description: "Double shot, steamed milk", kind: "espresso" } },
      { itemType: "brewer", name: "Espresso shot", source: { name: "Espresso", archived: false } },
      { itemType: "beans", source: null },
    ]);

    // Each source once per section; the beans block once per menu.
    const add = (item: Record<string, unknown>, to = section) => owner.agent.post(`${base}/sections/${to}/items`).send(item);
    expect((await add({ itemType: "drink", drinkId: latte })).status).toBe(409);
    const other = await menuSection(owner, ws.id, "Other");
    expect((await add({ itemType: "drink", drinkId: latte }, other)).status).toBe(201); // another section is fine
    expect((await add({ itemType: "beans" }, other)).status).toBe(409);
  });

  it("validates item types and references", async () => {
    const { owner, ws, base, drink } = await setup();
    const section = await menuSection(owner, ws.id, "Drinks");
    const latte = await drink("Latte");
    const otherWs = await newWorkspace(owner);
    const foreign = (await owner.agent.post(`/api/workspaces/${otherWs.id}/drinks`).send({ name: "Theirs", kind: "espresso" })).body.drink.id;
    const add = (item: Record<string, unknown>) => owner.agent.post(`${base}/sections/${section}/items`).send(item);
    expect((await add({ itemType: "drink" })).status).toBe(400);
    expect((await add({ itemType: "drink", drinkId: latte, brewerId: latte })).status).toBe(400);
    expect((await add({ itemType: "beans", drinkId: latte })).status).toBe(400);
    expect((await add({ itemType: "cocktail" })).status).toBe(400);
    expect((await add({ itemType: "drink", drinkId: foreign })).body.error).toMatch(/not a drink in this workspace/);
    expect((await owner.agent.post(`${base}/sections/${crypto.randomUUID()}/items`).send({ itemType: "beans" })).status).toBe(404);
  });

  it("prices need the menu's currency", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const section = await menuSection(owner, ws.id, "Drinks");
    const latte = await drink("Latte");
    const add = (item: Record<string, unknown>) => owner.agent.post(`${base}/sections/${section}/items`).send(item);
    expect((await add({ itemType: "drink", drinkId: latte, price: 5 })).body.error).toMatch(/currency/);
    expect((await owner.agent.patch(base).send({ currency: "usd" })).body.currency).toBe("USD");
    expect((await add({ itemType: "drink", drinkId: latte, price: 5.5 })).status).toBe(201);
    const item = (await get()).sections[0]!.items[0]!;
    expect(item.price).toBe(5.5);
    expect((await owner.agent.patch(`${base}/items/${item.id}`).send({ price: 5.555 })).status).toBe(400);
    // The currency can't be removed while items have prices.
    expect((await owner.agent.patch(base).send({ currency: null })).status).toBe(400);
    await owner.agent.patch(`${base}/items/${item.id}`).send({ price: null });
    expect((await owner.agent.patch(base).send({ currency: null })).body.currency).toBeNull();
    expect((await owner.agent.patch(base).send({ currency: "US" })).status).toBe(400);
  });

  it("edits, marks unavailable and deletes items", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const section = await menuSection(owner, ws.id, "Drinks");
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: await drink("Latte") });
    const id = (await get()).sections[0]!.items[0]!.id;
    const res = await owner.agent.patch(`${base}/items/${id}`).send({ name: "House latte", description: "With oat milk", available: false });
    expect(res.body.sections[0].items[0]).toMatchObject({ name: "House latte", description: "With oat milk", available: false });
    expect((await owner.agent.patch(`${base}/items/${id}`).send({ name: "" })).body.sections[0].items[0].name).toBeNull(); // back to the drink's
    expect((await owner.agent.patch(`${base}/items/${id}`).send({ itemType: "beans" })).status).toBe(400);
    expect((await owner.agent.delete(`${base}/items/${id}`)).body.sections[0].items).toEqual([]);
    expect((await owner.agent.delete(`${base}/items/${id}`)).status).toBe(404);
  });

  it("rearranges sections and items in one layout, including moves between sections", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const a = await menuSection(owner, ws.id, "A");
    const b = await menuSection(owner, ws.id, "B");
    await menuAdd(owner, ws.id, a, { itemType: "drink", drinkId: await drink("One") });
    await menuAdd(owner, ws.id, a, { itemType: "drink", drinkId: await drink("Two") });
    await menuAdd(owner, ws.id, b, { itemType: "beans" });
    const [one, two] = (await get()).sections[0]!.items.map((i) => i.id);
    const beans = (await get()).sections[1]!.items[0]!.id;

    const res = await owner.agent.put(`${base}/layout`).send({ sections: [{ id: b, itemIds: [two, beans] }, { id: a, itemIds: [one] }] });
    expect(res.status).toBe(200);
    expect(res.body.sections.map((s: Section) => [s.name, s.items.map((i) => i.source?.name ?? i.itemType)])).toEqual([
      ["B", ["Two", "beans"]],
      ["A", ["One"]],
    ]);

    const layout = (sections: unknown) => owner.agent.put(`${base}/layout`).send({ sections });
    expect((await layout([{ id: a, itemIds: [one, two, beans] }])).status).toBe(400); // section B missing
    expect((await layout([{ id: a, itemIds: [one] }, { id: b, itemIds: [two] }])).status).toBe(400); // beans block missing
    expect((await layout([{ id: a, itemIds: [one, one] }, { id: b, itemIds: [two, beans] }])).status).toBe(400);
  });

  it("refuses a layout that puts the same drink twice in a section", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const a = await menuSection(owner, ws.id, "A");
    const b = await menuSection(owner, ws.id, "B");
    const latte = await drink("Latte");
    await menuAdd(owner, ws.id, a, { itemType: "drink", drinkId: latte });
    await menuAdd(owner, ws.id, b, { itemType: "drink", drinkId: latte });
    const [x, y] = (await get()).sections.map((s) => s.items[0]!.id);
    const res = await owner.agent.put(`${base}/layout`).send({ sections: [{ id: a, itemIds: [x, y] }, { id: b, itemIds: [] }] });
    expect(res.body.error).toMatch(/only be in a section once/);
  });

  it("renames and deletes sections; deleting a drink removes its items", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const section = await menuSection(owner, ws.id, "Drinks");
    const latte = await drink("Latte");
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: latte });
    expect((await owner.agent.patch(`${base}/sections/${section}`).send({ name: "Coffee drinks", description: "All day" })).body.sections[0]).toMatchObject({ name: "Coffee drinks", description: "All day" });
    expect((await owner.agent.patch(`${base}/sections/${section}`).send({})).status).toBe(400);
    await owner.agent.delete(`/api/workspaces/${ws.id}/drinks/${latte}`);
    expect((await get()).sections[0]!.items).toEqual([]);
    expect((await owner.agent.delete(`${base}/sections/${section}`)).body.sections).toEqual([]);
    expect((await owner.agent.delete(`${base}/sections/${section}`)).status).toBe(404);
  });

  it("is readable by members and writable by owners and baristas only", async () => {
    const { owner, ws, base } = await setup();
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    const section = await menuSection(owner, ws.id, "Drinks");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(`${base}/sections`).send({ name: "X" })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/sections/${section}`)).status).toBe(403);
    expect((await outsider.agent.get(base)).status).toBe(404);
    // Another workspace's section or item isn't reachable through this one.
    const other = await newWorkspace(owner);
    expect((await owner.agent.patch(`/api/workspaces/${other.id}/menu/sections/${section}`).send({ name: "Mine" })).status).toBe(404);
  });
});

describe("public menu from the builder (docs/api/public-menu.md §7)", () => {
  it("follows the builder's order, with overrides, prices and availability", async () => {
    const { owner, ws, base, drink } = await setup();
    await owner.agent.patch(base).send({ currency: "USD" });
    const milk = await menuSection(owner, ws.id, "Milk drinks");
    const coffee = await menuSection(owner, ws.id, "Today's coffee");
    await menuSection(owner, ws.id, "Empty");
    const latte = await drink("Latte");
    const vanilla = await drink("Vanilla Latte", { parentDrinkId: latte });
    const secret = await drink("Secret");
    const riff = await drink("Secret riff", { parentDrinkId: secret });
    await menuAdd(owner, ws.id, milk, { itemType: "drink", drinkId: vanilla, price: 6 });
    await menuAdd(owner, ws.id, milk, { itemType: "drink", drinkId: latte, name: "House latte", price: 5, available: false });
    await menuAdd(owner, ws.id, milk, { itemType: "drink", drinkId: riff });
    await newBean(owner, ws.id, { beanName: "Guji" });
    await newBean(owner, ws.id, { beanName: "Archived" }).then((id) => owner.agent.patch(`/api/workspaces/${ws.id}/beans/${id}`).send({ archived: true }));
    await menuAdd(owner, ws.id, coffee, { itemType: "beans" });
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });

    const menu = (await request(app).get(`/api/public/menu/${ws.slug}`)).body;
    expect(menu.currency).toBe("USD");
    expect(menu.beans).toBeUndefined(); // beans live in their section now
    expect(menu.sections.map((s: { name: string }) => s.name)).toEqual(["Milk drinks", "Today's coffee"]); // empty left out
    expect(menu.sections[0].items).toMatchObject([
      { type: "drink", name: "Vanilla Latte", variantOf: "House latte", price: 6, available: true }, // the parent's menu name
      { type: "drink", name: "House latte", price: 5, available: false },
      { type: "drink", name: "Secret riff", variantOf: null }, // a parent off the menu isn't named
    ]);
    expect(menu.sections[1].items).toEqual([{ type: "beans", fields: expect.any(Array), beans: [expect.objectContaining({ beanName: "Guji" })] }]);
  });
});

describe("adding several items at once (docs/api/menu.md §7b)", () => {
  it("adds them last, in the order sent", async () => {
    const { owner, ws, base, drink } = await setup();
    const section = await menuSection(owner, ws.id, "Espresso");
    const [latte, mocha] = [await drink("Latte"), await drink("Mocha")];
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: latte });
    const espresso = await brewerId(owner, ws.id, "Espresso");
    const res = await owner.agent.post(`${base}/sections/${section}/items`).send({
      items: [{ itemType: "drink", drinkId: mocha }, { itemType: "brewer", brewerId: espresso, price: null }, { itemType: "beans" }],
    });
    expect(res.status).toBe(201);
    expect(res.body.sections[0].items.map((i: Item) => i.itemType)).toEqual(["drink", "drink", "brewer", "beans"]);
    expect(res.body.sections[0].items.map((i: Item) => i.source?.name ?? null)).toEqual(["Latte", "Mocha", "Espresso", null]);
  });

  it("is all or nothing: one refused item adds none", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const section = await menuSection(owner, ws.id, "Espresso");
    const [latte, mocha] = [await drink("Latte"), await drink("Mocha")];
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: latte });
    const other = await setup();
    const theirs = await other.drink("Theirs");
    const add = (items: unknown[]) => owner.agent.post(`${base}/sections/${section}/items`).send({ items });
    expect((await add([{ itemType: "drink", drinkId: mocha }, { itemType: "drink", drinkId: latte }])).status).toBe(409); // already there
    expect((await add([{ itemType: "drink", drinkId: mocha }, { itemType: "drink", drinkId: mocha }])).status).toBe(409); // twice
    expect((await add([{ itemType: "drink", drinkId: mocha }, { itemType: "drink", drinkId: theirs }])).status).toBe(400);
    expect((await add([{ itemType: "drink", drinkId: mocha }, { itemType: "brewer", brewerId: await brewerId(owner, ws.id, "V60"), price: 4 }])).status).toBe(400); // no currency
    expect((await add([])).status).toBe(400);
    expect((await get()).sections[0]!.items).toHaveLength(1);
  });
});

describe("menu preview (docs/api/menu.md §7b)", () => {
  it("matches the public menu, works while it's off, and only for members", async () => {
    const { owner, ws, base, drink } = await setup();
    const section = await menuSection(owner, ws.id, "Espresso");
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: await drink("Latte"), name: "House latte" });
    const preview = await owner.agent.get(`${base}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.sections[0].items[0]).toMatchObject({ type: "drink", name: "House latte" });
    expect((await request(app).get(`/api/public/menu/${ws.slug}`)).status).toBe(404); // the public menu is off

    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    expect((await request(app).get(`/api/public/menu/${ws.slug}`)).body).toEqual((await owner.agent.get(`${base}/preview`)).body);

    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(`${base}/preview`)).status).toBe(200);
    expect((await (await newUser()).agent.get(`${base}/preview`)).status).toBe(404);
  });
});

describe("what the beans block shows (docs/api/menu.md §7b)", () => {
  it("shows every field by default, only the chosen ones once set, and never stock", async () => {
    const { owner, ws, base, get } = await setup();
    const section = await menuSection(owner, ws.id, "Coffee");
    await newBean(owner, ws.id, { beanName: "Guji", process: "washed", country: "Ethiopia", region: "Guji", flavorProfile: "Peach", producer: "Shantawene", inventoryWeightGrams: 250 });
    await menuAdd(owner, ws.id, section, { itemType: "beans" });
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    const block = async () => (await request(app).get(`/api/public/menu/${ws.slug}`)).body.sections[0].items[0];

    const all = await block();
    expect(all.fields).toHaveLength(10);
    expect(all.beans[0]).toMatchObject({ beanName: "Guji", process: "washed", country: "Ethiopia", producer: "Shantawene", flavorProfile: "Peach" });
    expect(all.beans[0]).not.toHaveProperty("inventoryWeightGrams");

    const beansItem = (await get()).sections[0]!.items[0]! as Item & { beanFields: string[] | null };
    expect(beansItem.beanFields).toBeNull();
    const res = await owner.agent.patch(`${base}/items/${beansItem.id}`).send({ beanFields: ["origin", "flavorProfile"] });
    expect(res.body.sections[0].items[0].beanFields).toEqual(["origin", "flavorProfile"]);
    const chosen = await block();
    expect(chosen.fields).toEqual(["origin", "flavorProfile"]);
    expect(Object.keys(chosen.beans[0]).sort()).toEqual(["beanName", "country", "flavorProfile", "id", "originArea", "region", "roasterName"]);

    await owner.agent.patch(`${base}/items/${beansItem.id}`).send({ beanFields: [] });
    expect(Object.keys((await block()).beans[0]).sort()).toEqual(["beanName", "id", "roasterName"]);
    await owner.agent.patch(`${base}/items/${beansItem.id}`).send({ beanFields: null });
    expect((await block()).fields).toHaveLength(10);
  });

  it("is only for the beans block, with known fields once each", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const section = await menuSection(owner, ws.id, "Coffee");
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: await drink("Latte") });
    const latte = (await get()).sections[0]!.items[0]!;
    expect((await owner.agent.patch(`${base}/items/${latte.id}`).send({ beanFields: ["origin"] })).status).toBe(400);
    expect((await owner.agent.post(`${base}/sections/${section}/items`).send({ itemType: "beans", beanFields: ["price"] })).status).toBe(400);
    expect((await owner.agent.post(`${base}/sections/${section}/items`).send({ itemType: "beans", beanFields: ["origin", "origin"] })).status).toBe(400);
    const created = await owner.agent.post(`${base}/sections/${section}/items`).send({ itemType: "beans", beanFields: ["decaf"] });
    expect(created.body.sections[0].items[1].beanFields).toEqual(["decaf"]);
  });
});
