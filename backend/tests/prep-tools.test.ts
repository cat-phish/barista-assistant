import { describe, expect, it } from "vitest";
import { DEFAULT_PREP_TOOLS } from "@barista/shared/schema";
import { addMember, brewerId, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

interface Tool {
  id: string;
  name: string;
  methodKinds: string[];
  brewerIds: string[];
  position: number;
  archivedAt: string | null;
}

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/prep-tools`;
  const list = async () => (await owner.agent.get(base)).body.tools as Tool[];
  const byName = async (name: string) => (await list()).find((t) => t.name === name)!.id;
  return { owner, ws, base, list, byName };
}

describe("prep tools (docs/api/prep-tools.md §3d)", () => {
  it("new workspaces start with the default tools, in order", async () => {
    const { list } = await setup();
    const tools = await list();
    expect(tools.map((t) => [t.name, t.methodKinds, t.brewerIds])).toEqual(DEFAULT_PREP_TOOLS.map((t) => [t.name, t.methodKinds, []]));
    expect(tools.map((t) => t.position)).toEqual(tools.map((_, i) => i + 1));
  });

  it("add goes last; rename and change where it's offered; names unique; values checked", async () => {
    const { owner, base, list } = await setup();
    const created = await owner.agent.post(base).send({ name: " Melodrip ", methodKinds: ["filter", "stovetop"] });
    expect(created.status).toBe(201);
    expect(created.body.tool).toMatchObject({ name: "Melodrip", methodKinds: ["filter", "stovetop"], brewerIds: [], position: DEFAULT_PREP_TOOLS.length + 1, archivedAt: null });
    const any = await owner.agent.post(base).send({ name: "Scale" });
    expect(any.body.tool).toMatchObject({ methodKinds: [], brewerIds: [] });

    expect((await owner.agent.post(base).send({ name: "wdt" })).status).toBe(409);
    expect((await owner.agent.post(base).send({ name: "X", methodKinds: ["pour_over"] })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "X", methodKinds: ["filter", "filter"] })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "" })).status).toBe(400);

    const id = created.body.tool.id as string;
    const changed = await owner.agent.patch(`${base}/${id}`).send({ name: "Melodrip Duo", methodKinds: [] });
    expect(changed.body.tool).toMatchObject({ name: "Melodrip Duo", methodKinds: [] });
    expect((await owner.agent.patch(`${base}/${id}`).send({ name: "RDT" })).status).toBe(409);
    expect((await list()).at(-2)?.name).toBe("Melodrip Duo");
  });

  it("offered for chosen brewers: set, replaced, cleared; only this workspace's; a deleted brewer drops off", async () => {
    const { owner, ws, base, list } = await setup();
    const [v60, chemex] = [await brewerId(owner, ws.id, "V60"), await brewerId(owner, ws.id, "Aeropress")];
    const created = await owner.agent.post(base).send({ name: "Sandwich", methodKinds: ["espresso"], brewerIds: [v60] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.tool).toMatchObject({ methodKinds: ["espresso"], brewerIds: [v60] });
    const id = created.body.tool.id as string;

    const both = await owner.agent.patch(`${base}/${id}`).send({ brewerIds: [v60, chemex] });
    expect([...both.body.tool.brewerIds].sort()).toEqual([v60, chemex].sort());
    // Other fields leave the brewers alone.
    expect((await owner.agent.patch(`${base}/${id}`).send({ name: "Sandwiches" })).body.tool.brewerIds).toHaveLength(2);
    expect((await owner.agent.patch(`${base}/${id}`).send({ brewerIds: [chemex] })).body.tool.brewerIds).toEqual([chemex]);

    const other = await setup();
    const theirs = await brewerId(other.owner, other.ws.id, "V60");
    const foreign = await owner.agent.patch(`${base}/${id}`).send({ brewerIds: [theirs] });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toMatch(/brewerIds/);
    expect((await owner.agent.post(base).send({ name: "Y", brewerIds: [v60, v60] })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "Y", brewerIds: ["nope"] })).status).toBe(400);

    expect((await owner.agent.delete(`/api/workspaces/${ws.id}/brewers/${chemex}`)).status).toBe(204);
    expect((await list()).find((t) => t.id === id)?.brewerIds).toEqual([]);
  });

  it("reorder takes every tool exactly once", async () => {
    const { owner, base, list } = await setup();
    const ids = (await list()).map((t) => t.id);
    const reversed = [...ids].reverse();
    const res = await owner.agent.put(`${base}/order`).send({ toolIds: reversed });
    expect(res.status).toBe(200);
    expect(res.body.tools.map((t: Tool) => t.id)).toEqual(reversed);
    expect((await owner.agent.put(`${base}/order`).send({ toolIds: reversed.slice(1) })).status).toBe(400);
    expect((await owner.agent.put(`${base}/order`).send({ toolIds: [...reversed.slice(1), reversed[1]] })).status).toBe(400);
    const other = await setup();
    const foreign = (await other.list())[0]!.id;
    expect((await owner.agent.put(`${base}/order`).send({ toolIds: [...reversed.slice(1), foreign] })).status).toBe(400);
  });

  it("archive keeps the tool listed and flagged; restore clears it; delete unlinks brews", async () => {
    const { owner, ws, base, byName } = await setup();
    const shaker = await byName("Shaker");
    const archived = await owner.agent.patch(`${base}/${shaker}`).send({ archived: true });
    expect(archived.body.tool.archivedAt).toEqual(expect.any(String));
    expect((await owner.agent.patch(`${base}/${shaker}`).send({ archived: false })).body.tool.archivedAt).toBeNull();

    expect((await owner.agent.delete(`${base}/${await byName("Cloth filter")}`)).status).toBe(204);
    const wdt = await byName("WDT");
    const log = await newBrewLog(owner, ws.id, await newBean(owner, ws.id), { toolIds: [wdt] });
    expect((await owner.agent.get(`${base}/${wdt}/usage`)).body).toEqual({ brewLogCount: 1, recipeCount: 0 });
    expect((await owner.agent.delete(`${base}/${wdt}`)).status).toBe(204);
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs/${log}`)).body.brewLog.tools).toEqual([]);
  });

  it("viewers read only; outsiders get 404", async () => {
    const { owner, ws, base, byName } = await setup();
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    const rdt = await byName("RDT");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ name: "x" })).status).toBe(403);
    expect((await viewer.agent.patch(`${base}/${rdt}`).send({ archived: true })).status).toBe(403);
    expect((await viewer.agent.put(`${base}/order`).send({ toolIds: [rdt] })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/${rdt}`)).status).toBe(403);
    expect((await outsider.agent.get(base)).status).toBe(404);
  });
});

describe("brew logs with prep tools", () => {
  it("record tools in checklist order, replace them on PATCH, accept archived ones", async () => {
    const { owner, ws, base, byName } = await setup();
    const bean = await newBean(owner, ws.id);
    const logs = `/api/workspaces/${ws.id}/brew-logs`;
    const [rdt, wdt, screen] = [await byName("RDT"), await byName("WDT"), await byName("Puck screen")];

    const id = await newBrewLog(owner, ws.id, bean, { toolIds: [rdt, wdt] });
    const log = (await owner.agent.get(`${logs}/${id}`)).body.brewLog;
    expect(log.tools.map((t: Tool) => t.name)).toEqual(["WDT", "RDT"]); // position order, not sent order
    expect(log.tools[0]).toEqual({ id: wdt, name: "WDT" });

    await owner.agent.patch(`${base}/${screen}`).send({ archived: true });
    const replaced = await owner.agent.patch(`${logs}/${id}`).send({ toolIds: [screen] });
    expect(replaced.status).toBe(200);
    expect(replaced.body.brewLog.tools.map((t: Tool) => t.name)).toEqual(["Puck screen"]);

    // Other fields leave the tools alone; [] clears them.
    expect((await owner.agent.patch(`${logs}/${id}`).send({ rating: 4 })).body.brewLog.tools).toHaveLength(1);
    expect((await owner.agent.patch(`${logs}/${id}`).send({ toolIds: [] })).body.brewLog.tools).toEqual([]);
    expect((await owner.agent.get(logs)).body.brewLogs[0].tools).toEqual([]);
  });

  it("reject another workspace's tools and duplicates", async () => {
    const { owner, ws, byName } = await setup();
    const bean = await newBean(owner, ws.id);
    const logs = `/api/workspaces/${ws.id}/brew-logs`;
    const other = await setup();
    const theirs = await other.byName("RDT");
    const send = (toolIds: string[]) =>
      owner.agent.post(logs).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, toolIds });
    const foreign = await send([theirs]);
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toMatch(/toolIds/);
    const rdt = await byName("RDT");
    expect((await send([rdt, rdt])).status).toBe(400);
  });
});
