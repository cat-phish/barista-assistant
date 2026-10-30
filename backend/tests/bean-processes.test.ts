import { describe, expect, it } from "vitest";
import { addMember, menuWithBeans, newBean, newUser, newWorkspace, processId, publicMenuBeans } from "./helpers.js";

// docs/api/bean-processes.md §4b
async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/bean-processes`;
  const list = async () => (await owner.agent.get(base)).body.processes as Array<{ id: string; name: string; position: number; hidden: boolean; builtin: string | null }>;
  return { owner, ws, base, list };
}

describe("bean processes", () => {
  it("a new workspace starts with the ten built-ins, in order", async () => {
    const { list } = await setup();
    const processes = await list();
    expect(processes).toHaveLength(10);
    expect(processes[0]).toMatchObject({ name: "Washed", position: 1, hidden: false, builtin: "washed" });
    expect(processes.map((p) => p.builtin)).toContain("lactic");
  });

  it("adds custom ones last; names are unique per workspace", async () => {
    const { owner, base, list } = await setup();
    const res = await owner.agent.post(base).send({ name: "Yeast Inoculated" });
    expect(res.status).toBe(201);
    expect(res.body.process).toMatchObject({ name: "Yeast Inoculated", position: 11, hidden: false, builtin: null });
    expect((await owner.agent.post(base).send({ name: "washed" })).status).toBe(409); // case-insensitive
    expect((await owner.agent.post(base).send({ name: " " })).status).toBe(400);
    expect((await list()).at(-1)?.name).toBe("Yeast Inoculated");
  });

  it("renames and hides built-ins, which keep their key; built-ins can't be deleted", async () => {
    const { owner, ws, base } = await setup();
    const washed = await processId(owner, ws.id, "washed");
    const res = await owner.agent.patch(`${base}/${washed}`).send({ name: "Lavado", hidden: true });
    expect(res.body.process).toMatchObject({ name: "Lavado", hidden: true, builtin: "washed" });
    expect((await owner.agent.delete(`${base}/${washed}`)).status).toBe(409);
    expect((await owner.agent.patch(`${base}/${washed}`).send({ builtin: "natural" })).status).toBe(400);
  });

  it("deleting a custom one clears it from beans; usage counts them first", async () => {
    const { owner, ws, base } = await setup();
    const custom = (await owner.agent.post(base).send({ name: "Double Fermentation" })).body.process.id;
    const bean = await newBean(owner, ws.id, { processId: custom });
    expect((await owner.agent.get(`${base}/${custom}/usage`)).body).toEqual({ beanCount: 1 });
    expect((await owner.agent.delete(`${base}/${custom}`)).status).toBe(204);
    const beans = (await owner.agent.get(`/api/workspaces/${ws.id}/beans`)).body.beans as Array<{ id: string; processId: string | null }>;
    expect(beans.find((b) => b.id === bean)?.processId).toBeNull();
  });

  it("reorders with every id once", async () => {
    const { owner, base, list } = await setup();
    const ids = (await list()).map((p) => p.id);
    const reversed = [...ids].reverse();
    const res = await owner.agent.put(`${base}/order`).send({ processIds: reversed });
    expect(res.body.processes.map((p: { id: string }) => p.id)).toEqual(reversed);
    expect((await owner.agent.put(`${base}/order`).send({ processIds: ids.slice(1) })).status).toBe(400);
  });

  it("viewers read but can't change; other workspaces' processes are refused on beans", async () => {
    const { owner, ws, base } = await setup();
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ name: "Nope" })).status).toBe(403);
    const other = await newWorkspace(owner);
    const foreign = await processId(owner, other.id, "natural");
    expect((await owner.agent.post(`/api/workspaces/${ws.id}/beans`).send({ roasterName: "R", beanName: "B", processId: foreign })).status).toBe(400);
  });

  it("the public menu shows the process by its (renamed) name", async () => {
    const { owner, ws, base } = await setup();
    const honey = await processId(owner, ws.id, "honey");
    await owner.agent.patch(`${base}/${honey}`).send({ name: "Red Honey" });
    await newBean(owner, ws.id, { processId: honey });
    await menuWithBeans(owner, ws.id);
    expect((await publicMenuBeans(ws.slug))[0]).toMatchObject({ process: "Red Honey" });
  });
});
