import { describe, expect, it } from "vitest";
import { addMember, brewerId, newUser, newWorkspace } from "./helpers.js";

// docs/api/brewer-methods.md §3e
type Method = { id: string; name: string; position: number; hidden: boolean; builtin: string | null; behaviour: string };
async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/brewer-methods`;
  const brewersUrl = `/api/workspaces/${ws.id}/brewers`;
  const list = async () => (await owner.agent.get(base)).body.methods as Method[];
  const builtin = async (kind: string) => (await list()).find((m) => m.builtin === kind)!.id;
  return { owner, ws, base, brewersUrl, list, builtin };
}

describe("brewer methods", () => {
  it("a new workspace starts with the four built-ins, and its default brewers are under them", async () => {
    const { owner, brewersUrl, list } = await setup();
    const methods = await list();
    expect(methods.map((m) => `${m.name}:${m.builtin}:${m.behaviour}`)).toEqual(["Filter:filter:filter", "Espresso:espresso:espresso", "Stovetop:stovetop:stovetop", "Other:other:other"]);
    const brewers = (await owner.agent.get(brewersUrl)).body.brewers as Array<{ name: string; kind: string; methodId: string }>;
    const filter = methods[0]!.id;
    expect(brewers.find((b) => b.name === "V60")).toMatchObject({ kind: "filter", methodId: filter });
  });

  it("a custom method behaves like a built-in: its brewers take that kind", async () => {
    const { owner, base, brewersUrl } = await setup();
    const siphon = (await owner.agent.post(base).send({ name: "Siphon", behaviour: "filter" })).body.method;
    expect(siphon).toMatchObject({ name: "Siphon", position: 5, builtin: null, behaviour: "filter" });
    const made = await owner.agent.post(brewersUrl).send({ name: "Hario TCA", methodId: siphon.id });
    expect(made.status).toBe(201);
    expect(made.body.brewer).toMatchObject({ kind: "filter", methodId: siphon.id });
    // A kind that contradicts the method is refused; one that matches is fine.
    expect((await owner.agent.post(brewersUrl).send({ name: "X", methodId: siphon.id, kind: "espresso" })).status).toBe(400);
    expect((await owner.agent.post(brewersUrl).send({ name: "Y", methodId: siphon.id, kind: "filter" })).status).toBe(201);
    expect((await owner.agent.post(base).send({ name: "siphon", behaviour: "filter" })).status).toBe(409);
  });

  it("kind alone (older clients) means that kind's built-in method", async () => {
    const { owner, brewersUrl, builtin } = await setup();
    const made = await owner.agent.post(brewersUrl).send({ name: "Bialetti", kind: "stovetop" });
    expect(made.body.brewer).toMatchObject({ kind: "stovetop", methodId: await builtin("stovetop") });
    const plain = await owner.agent.post(brewersUrl).send({ name: "Mystery" });
    expect(plain.body.brewer).toMatchObject({ kind: "filter", methodId: await builtin("filter") });
  });

  it("moving a brewer to a method of another behaviour is refused while it has recipes", async () => {
    const { owner, ws, base, brewersUrl, builtin } = await setup();
    const turkish = (await owner.agent.post(base).send({ name: "Turkish", behaviour: "stovetop" })).body.method.id;
    const v60 = await brewerId(owner, ws.id, "V60");
    await owner.agent.post(`/api/workspaces/${ws.id}/recipes`).send({ name: "R", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 });
    const moved = await owner.agent.patch(`${brewersUrl}/${v60}`).send({ methodId: turkish });
    expect(moved.status).toBe(409);
    // Same behaviour: fine.
    const pourOver = (await owner.agent.post(base).send({ name: "Pour over gear", behaviour: "filter" })).body.method.id;
    expect((await owner.agent.patch(`${brewersUrl}/${v60}`).send({ methodId: pourOver })).body.brewer).toMatchObject({ kind: "filter", methodId: pourOver });
    const filter = await builtin("filter");
    expect((await owner.agent.patch(`${brewersUrl}/${v60}`).send({ methodId: filter })).status).toBe(200);
  });

  it("a custom method's behaviour changes its brewers' kind, unless recipes use them", async () => {
    const { owner, ws, base, brewersUrl } = await setup();
    const odd = (await owner.agent.post(base).send({ name: "Odd", behaviour: "other" })).body.method.id;
    const brewer = (await owner.agent.post(brewersUrl).send({ name: "Gadget", methodId: odd })).body.brewer.id;
    expect((await owner.agent.patch(`${base}/${odd}`).send({ behaviour: "filter" })).body.method.behaviour).toBe("filter");
    const kinds = (await owner.agent.get(brewersUrl)).body.brewers as Array<{ id: string; kind: string }>;
    expect(kinds.find((b) => b.id === brewer)?.kind).toBe("filter");
    await owner.agent.post(`/api/workspaces/${ws.id}/recipes`).send({ name: "G", brewerId: brewer, targetDoseGrams: 15, targetWaterGrams: 250 });
    const refused = await owner.agent.patch(`${base}/${odd}`).send({ behaviour: "other" });
    expect(refused.status).toBe(409);
    expect(refused.body.recipeCount).toBe(1);
  });

  it("built-ins rename and hide but not delete or change behaviour; deleting a custom one moves its brewers home", async () => {
    const { owner, base, brewersUrl, builtin } = await setup();
    const filter = await builtin("filter");
    expect((await owner.agent.patch(`${base}/${filter}`).send({ name: "Pour & steep", hidden: true })).body.method).toMatchObject({ name: "Pour & steep", hidden: true, builtin: "filter" });
    expect((await owner.agent.patch(`${base}/${filter}`).send({ behaviour: "espresso" })).status).toBe(400);
    expect((await owner.agent.delete(`${base}/${filter}`)).status).toBe(409);

    const siphon = (await owner.agent.post(base).send({ name: "Siphon", behaviour: "filter" })).body.method.id;
    const brewer = (await owner.agent.post(brewersUrl).send({ name: "Hario TCA", methodId: siphon })).body.brewer.id;
    expect((await owner.agent.get(`${base}/${siphon}/usage`)).body).toEqual({ brewerCount: 1 });
    expect((await owner.agent.delete(`${base}/${siphon}`)).status).toBe(204);
    const after = ((await owner.agent.get(brewersUrl)).body.brewers as Array<{ id: string; kind: string; methodId: string }>).find((b) => b.id === brewer);
    expect(after).toMatchObject({ kind: "filter", methodId: filter });
  });

  it("reorders with every id once; viewers read only", async () => {
    const { owner, ws, base, list } = await setup();
    const ids = (await list()).map((m) => m.id);
    expect((await owner.agent.put(`${base}/order`).send({ methodIds: [...ids].reverse() })).body.methods[0].builtin).toBe("other");
    expect((await owner.agent.put(`${base}/order`).send({ methodIds: ids.slice(1) })).status).toBe(400);
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ name: "Nope", behaviour: "filter" })).status).toBe(403);
  });

  it("the public menu says how a plain brew is made by its brewer's method", async () => {
    const { owner, ws, base, brewersUrl } = await setup();
    const siphon = (await owner.agent.post(base).send({ name: "Siphon", behaviour: "filter" })).body.method.id;
    const brewer = (await owner.agent.post(brewersUrl).send({ name: "Hario TCA", methodId: siphon })).body.brewer.id;
    const menu = `/api/workspaces/${ws.id}/menu`;
    const section = (await owner.agent.post(`${menu}/sections`).send({ name: "Coffee" })).body;
    const sectionId = section.sections?.[0]?.id ?? section.section?.id;
    await owner.agent.post(`${menu}/sections/${sectionId}/items`).send({ itemType: "brewer", brewerId: brewer });
    const preview = (await owner.agent.get(`${menu}/preview`)).body;
    expect(preview.sections[0].items[0]).toMatchObject({ type: "brewer", name: "Hario TCA", method: "Siphon" });
  });
});
