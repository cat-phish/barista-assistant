import { existsSync } from "node:fs";
import sharp from "sharp";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { photoPath, sweepOrphanPhotos } from "../src/photos.js";
import { addMember, brewerId, menuAdd, menuOtherItem, menuSection, newBean, newUser, newWorkspace, processId } from "./helpers.js";

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
  const get = async () => (await owner.agent.get(base)).body as { currency: string | null; sections: Section[]; otherItems: Array<{ id: string; menuItemCount: number }> };
  return { owner, ws, base, drink, get };
}

describe("menu builder (docs/api/menu.md §7b)", () => {
  it("starts empty, and adds sections last", async () => {
    const { owner, ws, base, get } = await setup();
    expect(await get()).toEqual({ title: null, currency: null, showMethod: true, showIngredients: false, accentColor: null, tagline: null, logoId: null, logoIds: [], sections: [], otherItems: [] });
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

describe("other items (docs/api/menu.md §7b)", () => {
  it("keeps a list of other items, names unique, writes for baristas", async () => {
    const { owner, ws, base, get } = await setup();
    const scone = await menuOtherItem(owner, ws.id, "Scone", "Baked daily");
    await menuOtherItem(owner, ws.id, "Almond croissant");
    expect((await get()).otherItems).toEqual([
      { id: expect.any(String), name: "Almond croissant", description: null, menuItemCount: 0 },
      { id: scone, name: "Scone", description: "Baked daily", menuItemCount: 0 },
    ]);
    expect((await owner.agent.post(`${base}/other-items`).send({ name: "scone" })).status).toBe(409);
    expect((await owner.agent.post(`${base}/other-items`).send({ name: " " })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/other-items/${scone}`).send({ name: "Cheese scone", description: "" })).body.otherItems[1]).toMatchObject({ name: "Cheese scone", description: null });
    expect((await owner.agent.patch(`${base}/other-items/${scone}`).send({ name: "Almond croissant" })).status).toBe(409);

    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).body.otherItems).toHaveLength(2);
    expect((await viewer.agent.post(`${base}/other-items`).send({ name: "Mine" })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/other-items/${scone}`)).status).toBe(403);

    const otherWs = await newWorkspace(owner);
    expect((await owner.agent.patch(`/api/workspaces/${otherWs.id}/menu/other-items/${scone}`).send({ name: "X" })).status).toBe(404);
    expect((await owner.agent.delete(`/api/workspaces/${otherWs.id}/menu/other-items/${scone}`)).status).toBe(404);
    expect((await owner.agent.get(`/api/workspaces/${otherWs.id}/menu/other-items/${scone}/usage`)).status).toBe(404);
  });

  it("places an other item like a drink, with its own price per section", async () => {
    const { owner, ws, base, drink, get } = await setup();
    await owner.agent.patch(base).send({ currency: "USD" });
    const food = await menuSection(owner, ws.id, "Food");
    const happy = await menuSection(owner, ws.id, "Happy hour");
    const croissant = await menuOtherItem(owner, ws.id, "Almond croissant", "Baked daily");
    await menuAdd(owner, ws.id, food, { itemType: "other", otherItemId: croissant, price: 3.5 });
    await menuAdd(owner, ws.id, happy, { itemType: "other", otherItemId: croissant, name: "Croissant", sizes: [{ label: "One", price: 2 }, { label: "Two", price: 3.5 }] });
    const menu = await get();
    expect(menu.sections[0]!.items[0]).toMatchObject({ itemType: "other", otherItemId: croissant, name: null, price: 3.5, showMethod: null, showIngredients: null, source: { name: "Almond croissant", description: "Baked daily", kind: null, method: null, archived: false } });
    expect(menu.sections[1]!.items[0]).toMatchObject({ name: "Croissant", price: null, sizes: [{ label: "One", price: 2 }, { label: "Two", price: 3.5 }] });
    expect(menu.otherItems[0]).toMatchObject({ menuItemCount: 2 });
    expect((await owner.agent.get(`${base}/other-items/${croissant}/usage`)).body).toEqual({ menuItemCount: 2 });

    const add = (item: Record<string, unknown>) => owner.agent.post(`${base}/sections/${food}/items`).send(item);
    expect((await add({ itemType: "other", otherItemId: croissant })).status).toBe(409); // once per section
    expect((await add({ itemType: "other" })).status).toBe(400);
    expect((await add({ itemType: "other", otherItemId: croissant, drinkId: await drink("Latte") })).status).toBe(400);
    expect((await add({ itemType: "drink", otherItemId: croissant })).status).toBe(400);
    expect((await add({ itemType: "beans", otherItemId: croissant })).status).toBe(400);
    expect((await add({ itemType: "other", otherItemId: croissant, showMethod: true })).status).toBe(400);
    const theirs = await menuOtherItem(owner, (await newWorkspace(owner)).id, "Theirs");
    expect((await add({ itemType: "other", otherItemId: theirs })).body.error).toMatch(/not an other item in this workspace/);

    const id = menu.sections[0]!.items[0]!.id;
    expect((await owner.agent.patch(`${base}/items/${id}`).send({ name: "Croissant", available: false })).status).toBe(200);
    expect((await owner.agent.patch(`${base}/items/${id}`).send({ name: null })).status).toBe(200); // back to its own name
    expect((await owner.agent.patch(`${base}/items/${id}`).send({ showIngredients: true })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/items/${id}`).send({ beanFields: null })).status).toBe(400);
  });

  it("keeps the other item when its section goes, and its entries go with it", async () => {
    const { owner, ws, base, get } = await setup();
    const food = await menuSection(owner, ws.id, "Food");
    const happy = await menuSection(owner, ws.id, "Happy hour");
    const scone = await menuOtherItem(owner, ws.id, "Scone");
    await menuAdd(owner, ws.id, food, { itemType: "other", otherItemId: scone });
    await menuAdd(owner, ws.id, happy, { itemType: "other", otherItemId: scone });
    // Not twice in one section by dragging either.
    const [f, h] = (await get()).sections;
    const both = await owner.agent.put(`${base}/layout`).send({ sections: [{ id: food, itemIds: [f!.items[0]!.id, h!.items[0]!.id] }, { id: happy, itemIds: [] }] });
    expect(both.body.error).toMatch(/only be in a section once/);

    expect((await owner.agent.delete(`${base}/sections/${food}`)).status).toBe(200);
    expect((await get()).otherItems).toEqual([{ id: scone, name: "Scone", description: null, menuItemCount: 1 }]);
    const res = await owner.agent.delete(`${base}/other-items/${scone}`);
    expect(res.body.otherItems).toEqual([]);
    expect(res.body.sections[0].items).toEqual([]);
    expect((await owner.agent.delete(`${base}/other-items/${scone}`)).status).toBe(404);
  });

  it("shows on the public menu and the preview with nothing under it", async () => {
    const { owner, ws, base } = await setup();
    await owner.agent.patch(base).send({ currency: "USD" });
    const food = await menuSection(owner, ws.id, "Food");
    const croissant = await menuOtherItem(owner, ws.id, "Almond croissant", "Baked daily");
    const decaf = await menuOtherItem(owner, ws.id, "Ask about our decaf");
    await menuAdd(owner, ws.id, food, { itemType: "other", otherItemId: croissant, price: 3.5 });
    await menuAdd(owner, ws.id, food, { itemType: "other", otherItemId: decaf, name: "Decaf?", description: "Just ask", available: false });
    const expected = [
      { type: "other", id: croissant, name: "Almond croissant", description: "Baked daily", method: null, variantOf: null, ingredients: [], price: 3.5, sizes: null, available: true },
      { type: "other", id: decaf, name: "Decaf?", description: "Just ask", method: null, variantOf: null, ingredients: [], price: null, sizes: null, available: false },
    ];
    expect((await owner.agent.get(`${base}/preview`)).body.sections[0].items).toEqual(expected);
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    expect((await request(app).get(`/api/public/menu/${ws.slug}`)).body.sections[0].items).toEqual(expected);
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
    await newBean(owner, ws.id, { beanName: "Guji", processId: await processId(owner, ws.id, "washed"), country: "Ethiopia", region: "Guji", flavorProfile: "Peach", producer: "Shantawene", inventoryWeightGrams: 250 });
    await menuAdd(owner, ws.id, section, { itemType: "beans" });
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    const block = async () => (await request(app).get(`/api/public/menu/${ws.slug}`)).body.sections[0].items[0];

    const all = await block();
    expect(all.fields).toHaveLength(11);
    expect(all.beans[0]).toMatchObject({ beanName: "Guji", process: "Washed", country: "Ethiopia", producer: "Shantawene", flavorProfile: "Peach" });
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
    expect((await block()).fields).toHaveLength(11);
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

describe("menu title (docs/api/menu.md §7b)", () => {
  it("defaults to the workspace name; set, blank and cleared from the menu settings", async () => {
    const { owner, ws, base } = await setup();
    await owner.agent.patch(`/api/workspaces/${ws.id}`).send({ isPublicMenuEnabled: true });
    const publicTitle = async () => (await request(app).get(`/api/public/menu/${ws.slug}`)).body.title;
    const name = (await owner.agent.get(`${base}/preview`)).body.workspace.name;
    expect(await publicTitle()).toBe(name);

    const set = await owner.agent.patch(base).send({ title: "  The Brew Bar  " });
    expect(set.body).toMatchObject({ title: "The Brew Bar", currency: null });
    expect(await publicTitle()).toBe("The Brew Bar");
    expect((await owner.agent.get(`${base}/preview`)).body.title).toBe("The Brew Bar");

    await owner.agent.patch(base).send({ currency: "usd" }); // the title stays
    expect((await owner.agent.get(base)).body).toMatchObject({ title: "The Brew Bar", currency: "USD" });
    expect((await owner.agent.patch(base).send({ title: "" })).body.title).toBeNull();
    expect(await publicTitle()).toBe(name);
    expect((await owner.agent.patch(base).send({ title: "x".repeat(256) })).status).toBe(400);
    expect((await owner.agent.patch(base).send({})).status).toBe(400);
  });
});

describe("what drinks show under them (docs/api/menu.md §7b)", () => {
  it("shows how it's made but not ingredients by default; the menu and each item can change that", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const section = await menuSection(owner, ws.id, "Milk drinks");
    const milk = (await owner.agent.post(`/api/workspaces/${ws.id}/ingredients`).send({ name: "Steamed milk", ingredientType: "milk" })).body;
    const milkId = (milk.ingredient ?? milk).id as string;
    const latte = await drink("Latte", { ingredients: [{ ingredientId: milkId }] });
    const mocha = await drink("Mocha", { ingredients: [{ ingredientId: milkId }] });
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: latte });
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: mocha, showMethod: false, showIngredients: true });
    const items = async () => (await owner.agent.get(`${base}/preview`)).body.sections[0].items as Array<{ name: string; method: string | null; ingredients: string[] }>;

    expect((await items()).map((i) => [i.method, i.ingredients])).toEqual([
      ["Espresso", []],
      [null, ["Steamed milk"]],
    ]);
    const mochaItem = (await get()).sections[0]!.items[1]! as Item & { showMethod: boolean | null; showIngredients: boolean | null };
    expect(mochaItem).toMatchObject({ showMethod: false, showIngredients: true });

    const patched = await owner.agent.patch(base).send({ showMethod: false, showIngredients: true });
    expect(patched.body).toMatchObject({ showMethod: false, showIngredients: true });
    expect((await items()).map((i) => [i.method, i.ingredients])).toEqual([
      [null, ["Steamed milk"]],
      [null, ["Steamed milk"]],
    ]);

    // Back to the menu's default.
    await owner.agent.patch(`${base}/items/${mochaItem.id}`).send({ showMethod: true, showIngredients: null });
    await owner.agent.patch(base).send({ showIngredients: false });
    expect((await items()).map((i) => [i.method, i.ingredients])).toEqual([
      [null, []],
      ["Espresso", []],
    ]);
  });

  it("keeps variantOf, and the switches are only for drinks and brewers", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const section = await menuSection(owner, ws.id, "Milk drinks");
    const latte = await drink("Latte");
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: latte });
    await menuAdd(owner, ws.id, section, { itemType: "drink", drinkId: await drink("Vanilla Latte", { parentDrinkId: latte }) });
    await menuAdd(owner, ws.id, section, { itemType: "beans" });
    expect((await owner.agent.get(`${base}/preview`)).body.sections[0].items[1]).toMatchObject({ variantOf: "Latte" });

    const [latteItem, , beansItem] = (await get()).sections[0]!.items;
    expect((await owner.agent.patch(`${base}/items/${beansItem!.id}`).send({ showMethod: false })).status).toBe(400);
    expect((await owner.agent.patch(`${base}/items/${latteItem!.id}`).send({ beanBatches: "once" })).status).toBe(400);
    const mocha = await drink("Mocha");
    expect((await owner.agent.post(`${base}/sections/${section}/items`).send({ itemType: "drink", drinkId: mocha, beanBatches: "each" })).status).toBe(400);
    expect((await owner.agent.patch(base).send({ showMethod: "yes" })).status).toBe(400);
  });
});

describe("the same coffee more than once (docs/api/public-menu.md §7)", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  async function twoBatches() {
    const { owner, ws, base, get } = await setup();
    const section = await menuSection(owner, ws.id, "Coffee");
    const older = await newBean(owner, ws.id, { beanName: "Guji", batchNumber: "3", roastDate: daysAgo(20), flavorProfile: "Peach" });
    const newer = await newBean(owner, ws.id, { beanName: "guji ", batchNumber: "4", roastDate: daysAgo(5), flavorProfile: "Peach" });
    const other = await newBean(owner, ws.id, { beanName: "Kenya", roastDate: daysAgo(3) });
    await menuAdd(owner, ws.id, section, { itemType: "beans" });
    const beansItem = (await get()).sections[0]!.items[0]!;
    const block = async () => (await owner.agent.get(`${base}/preview`)).body.sections[0].items[0];
    return { owner, ws, base, beansItem, block, older, newer, other };
  }

  it("lists each by default, with what tells them apart", async () => {
    const { owner, base, beansItem, block, older, newer, other } = await twoBatches();
    const { beans } = await block();
    const byId = new Map(beans.map((b: { id: string }) => [b.id, b]));
    expect(beans).toHaveLength(3);
    expect(byId.get(older)).toMatchObject({ batchNumber: "3", differs: ["roastDate", "batchNumber"], freezes: [] });
    expect(byId.get(newer)).toMatchObject({ batchNumber: "4", differs: ["roastDate", "batchNumber"] });
    expect(byId.get(other)).not.toHaveProperty("differs");
    expect(byId.get(other)).not.toHaveProperty("batchNumber");

    // A difference the block hides is still sent when nothing shown differs.
    await owner.agent.patch(`${base}/items/${beansItem.id}`).send({ beanFields: ["flavorProfile"] });
    const hidden = new Map((await block()).beans.map((b: { id: string }) => [b.id, b]));
    expect(hidden.get(older)).toMatchObject({ differs: ["batchNumber"], batchNumber: "3" });
    expect(hidden.get(older)).not.toHaveProperty("roastDate");
  });

  it("shows the freshest unfrozen one once when asked", async () => {
    const { owner, ws, base, beansItem, block, older, newer, other } = await twoBatches();
    const patched = await owner.agent.patch(`${base}/items/${beansItem.id}`).send({ beanBatches: "once" });
    expect(patched.body.sections[0].items[0].beanBatches).toBe("once");
    let ids = (await block()).beans.map((b: { id: string }) => b.id);
    expect(ids.sort()).toEqual([newer, other].sort());
    expect((await block()).beans.find((b: { id: string }) => b.id === newer)).not.toHaveProperty("differs");

    // The newer one goes in the freezer: the older one is what's served.
    await owner.agent.post(`/api/workspaces/${ws.id}/beans/${newer}/freeze`).send({ date: daysAgo(1) });
    ids = (await block()).beans.map((b: { id: string }) => b.id);
    expect(ids.sort()).toEqual([older, other].sort());
  });

  it("sends a bean's freezes with its roast date, so its age pauses while frozen", async () => {
    const { owner, ws, base, beansItem, block, newer } = await twoBatches();
    await owner.agent.post(`/api/workspaces/${ws.id}/beans/${newer}/freeze`).send({ date: daysAgo(2) });
    expect((await block()).beans.find((b: { id: string }) => b.id === newer).freezes).toEqual([{ frozenOn: daysAgo(2), thawedOn: null }]);
    await owner.agent.patch(`${base}/items/${beansItem.id}`).send({ beanFields: ["origin"], beanBatches: "once" });
    expect((await block()).beans[0]).not.toHaveProperty("freezes");
  });
});

describe("menu branding (docs/api/menu.md §7b)", () => {
  const png = () => sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();

  it("sets an accent colour and tagline that guests see", async () => {
    const { owner, ws, base } = await setup();
    expect((await owner.agent.get(base)).body).toMatchObject({ accentColor: null, tagline: null, logoId: null });
    const set = await owner.agent.patch(base).send({ accentColor: " #8A4B2A ", tagline: "  Coffee, slowly  " });
    expect(set.body).toMatchObject({ accentColor: "#8a4b2a", tagline: "Coffee, slowly" });
    expect((await owner.agent.get(`${base}/preview`)).body).toMatchObject({ accentColor: "#8a4b2a", tagline: "Coffee, slowly", logoUrl: null });
    for (const accentColor of ["red", "#fff", "#12345g"]) expect((await owner.agent.patch(base).send({ accentColor })).status).toBe(400);
    expect((await owner.agent.patch(base).send({ tagline: "x".repeat(256) })).status).toBe(400);
    expect((await owner.agent.patch(base).send({ accentColor: null, tagline: "" })).body).toMatchObject({ accentColor: null, tagline: null });
  });

  it("keeps several logos in order: the first shows, the others swap in", async () => {
    const { owner, ws, base } = await setup();
    const add = () => owner.agent.post(`${base}/logos`).set("Content-Type", "image/png");
    expect((await owner.agent.post(`${base}/logos`).set("Content-Type", "text/plain").send("not an image")).status).toBe(400);
    const one = await add().send(await png());
    expect(one.status).toBe(201);
    const first = one.body.logoId as string;
    expect(one.body.logoIds).toEqual([first]);
    const { logoUrl } = (await owner.agent.get(`${base}/preview`)).body;
    expect(logoUrl).toBe(`/api/public/menu/${ws.slug}/logo/${first}`);

    // Anyone with the URL, even while the menu is off; it never changes.
    const img = await request(app).get(logoUrl);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(img.headers["cache-control"]).toMatch(/immutable/);
    expect((await sharp(img.body as Buffer).metadata()).hasAlpha).toBe(true); // a transparent logo stays transparent
    expect((await request(app).get(`/api/public/menu/${ws.slug}/logo/${crypto.randomUUID()}`)).status).toBe(404);

    // A second is kept, not shown; it's served too (Settings shows it).
    const second = ((await add().send(await png())).body.logoIds as string[])[1]!;
    expect((await owner.agent.get(`${base}/preview`)).body.logoUrl).toBe(logoUrl);
    expect((await request(app).get(`/api/public/menu/${ws.slug}/logo/${second}`)).status).toBe(200);

    // Reordered: the second shows.
    expect((await owner.agent.put(`${base}/logos/order`).send({ logoIds: [second] })).status).toBe(400);
    expect((await owner.agent.put(`${base}/logos/order`).send({ logoIds: [second, first] })).body).toMatchObject({ logoId: second, logoIds: [second, first] });

    // Cropped: a new id in its place, the old file gone.
    const cropped = await owner.agent.put(`${base}/logos/${second}/image`).set("Content-Type", "image/png").send(await png());
    const third = cropped.body.logoId as string;
    expect(cropped.body.logoIds).toEqual([third, first]);
    expect(third).not.toBe(second);
    expect((await request(app).get(`/api/public/menu/${ws.slug}/logo/${second}`)).status).toBe(404);
    expect((await owner.agent.put(`${base}/logos/${second}/image`).set("Content-Type", "image/png").send(await png())).status).toBe(404);

    // Removed: the next moves up; then none.
    expect((await owner.agent.delete(`${base}/logos/${third}`)).body).toMatchObject({ logoId: first, logoIds: [first] });
    expect((await request(app).get(`/api/public/menu/${ws.slug}/logo/${third}`)).status).toBe(404);
    expect((await owner.agent.delete(`${base}/logos/${third}`)).status).toBe(404);
    expect((await owner.agent.delete(`${base}/logos/${first}`)).body).toMatchObject({ logoId: null, logoIds: [] });

    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.post(`${base}/logos`).set("Content-Type", "image/png").send(await png())).status).toBe(403);
  });

  it("keeps at most 6 logos", async () => {
    const { owner, ws, base } = await setup();
    const image = await png();
    for (let i = 0; i < 6; i++) expect((await owner.agent.post(`${base}/logos`).set("Content-Type", "image/png").send(image)).status).toBe(201);
    expect((await owner.agent.post(`${base}/logos`).set("Content-Type", "image/png").send(image)).status).toBe(409);
    const { logoIds } = (await owner.agent.get(base)).body as { logoIds: string[] };
    expect(logoIds).toHaveLength(6);
    // The start-up sweep keeps every one, not only the first.
    await sweepOrphanPhotos();
    for (const id of logoIds) expect(existsSync(photoPath(ws.id, id))).toBe(true);
  });
});

describe("sizes (docs/api/menu.md §7b)", () => {
  it("prices each size instead of one price, shown to guests in order", async () => {
    const { owner, ws, base, drink, get } = await setup();
    const section = await menuSection(owner, ws.id, "Milk drinks");
    const latte = await drink("Latte");
    const add = (item: Record<string, unknown>) => owner.agent.post(`${base}/sections/${section}/items`).send(item);
    const sizes = [{ label: "8 oz", price: 4 }, { label: "12 oz", price: 4.75 }];
    expect((await add({ itemType: "drink", drinkId: latte, sizes })).body.error).toMatch(/currency/);
    await owner.agent.patch(base).send({ currency: "USD" });
    expect((await add({ itemType: "drink", drinkId: latte, sizes, price: 4 })).status).toBe(400); // both
    expect((await add({ itemType: "drink", drinkId: latte, sizes: [] })).status).toBe(400);
    expect((await add({ itemType: "drink", drinkId: latte, sizes: [{ label: "8 oz", price: 4 }, { label: "8 OZ", price: 5 }] })).status).toBe(400);
    expect((await add({ itemType: "drink", drinkId: latte, sizes: [{ label: "x", price: 4.555 }] })).status).toBe(400);
    expect((await add({ itemType: "beans", sizes })).status).toBe(400);
    expect((await add({ itemType: "drink", drinkId: latte, sizes })).status).toBe(201);

    const item = (await get()).sections[0]!.items[0]! as Item & { sizes: unknown };
    expect(item).toMatchObject({ price: null, sizes });
    expect((await owner.agent.get(`${base}/preview`)).body.sections[0].items[0]).toMatchObject({ price: null, sizes });

    // A price while it has sizes is refused; clearing the sizes allows it.
    expect((await owner.agent.patch(`${base}/items/${item.id}`).send({ price: 5 })).status).toBe(400);
    expect((await owner.agent.patch(base).send({ currency: null })).status).toBe(400); // size prices need it
    const back = await owner.agent.patch(`${base}/items/${item.id}`).send({ sizes: null, price: 5 });
    expect(back.body.sections[0].items[0]).toMatchObject({ price: 5, sizes: null });

    // Sizes without prices don't need a currency.
    await owner.agent.patch(`${base}/items/${item.id}`).send({ price: null, sizes: [{ label: "Small", price: null }] });
    expect((await owner.agent.patch(base).send({ currency: null })).status).toBe(200);
  });
});
