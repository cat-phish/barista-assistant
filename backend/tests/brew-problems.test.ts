import { describe, expect, it } from "vitest";
import { DEFAULT_BREW_PROBLEMS } from "@barista/shared/schema";
import { addMember, newBean, newBrewLog, newUser, newWorkspace } from "./helpers.js";

interface Problem {
  id: string;
  name: string;
  methodKind: string | null;
  position: number;
  archivedAt: string | null;
}

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/brew-problems`;
  const list = async () => (await owner.agent.get(base)).body.problems as Problem[];
  const byName = async (name: string) => (await list()).find((p) => p.name === name)!.id;
  return { owner, ws, base, list, byName };
}

describe("brew problems (docs/api/brew-problems.md §6b)", () => {
  it("new workspaces start with the default problems, in order", async () => {
    const { list } = await setup();
    const problems = await list();
    expect(problems.map((p) => [p.name, p.methodKind])).toEqual(DEFAULT_BREW_PROBLEMS.map((p) => [p.name, p.methodKind]));
    expect(problems.map((p) => p.position)).toEqual(problems.map((_, i) => i + 1));
  });

  it("add goes last; rename and change method; names unique; method values checked", async () => {
    const { owner, base, list } = await setup();
    const created = await owner.agent.post(base).send({ name: " Paper taste ", methodKind: "filter" });
    expect(created.status).toBe(201);
    expect(created.body.problem).toMatchObject({ name: "Paper taste", methodKind: "filter", position: DEFAULT_BREW_PROBLEMS.length + 1, archivedAt: null });
    const any = await owner.agent.post(base).send({ name: "Spilled" });
    expect(any.body.problem.methodKind).toBeNull();

    expect((await owner.agent.post(base).send({ name: "fast drawdown" })).status).toBe(409);
    expect((await owner.agent.post(base).send({ name: "X", methodKind: "pour_over" })).status).toBe(400);
    expect((await owner.agent.post(base).send({ name: "" })).status).toBe(400);

    const id = created.body.problem.id as string;
    const changed = await owner.agent.patch(`${base}/${id}`).send({ name: "Papery", methodKind: null });
    expect(changed.body.problem).toMatchObject({ name: "Papery", methodKind: null });
    expect((await owner.agent.patch(`${base}/${id}`).send({ name: "Scale not tared" })).status).toBe(409);
    expect((await list()).at(-2)?.name).toBe("Papery");
  });

  it("reorder takes every problem exactly once", async () => {
    const { owner, base, list } = await setup();
    const reversed = (await list()).map((p) => p.id).reverse();
    const res = await owner.agent.put(`${base}/order`).send({ problemIds: reversed });
    expect(res.status).toBe(200);
    expect(res.body.problems.map((p: Problem) => p.id)).toEqual(reversed);
    expect((await owner.agent.put(`${base}/order`).send({ problemIds: reversed.slice(1) })).status).toBe(400);
    const other = await setup();
    const foreign = (await other.list())[0]!.id;
    expect((await owner.agent.put(`${base}/order`).send({ problemIds: [...reversed.slice(1), foreign] })).status).toBe(400);
  });

  it("archive keeps the problem listed and flagged; restore clears it; delete unlinks brews", async () => {
    const { owner, ws, base, byName } = await setup();
    const fast = await byName("Fast drawdown");
    expect((await owner.agent.patch(`${base}/${fast}`).send({ archived: true })).body.problem.archivedAt).toEqual(expect.any(String));
    expect((await owner.agent.patch(`${base}/${fast}`).send({ archived: false })).body.problem.archivedAt).toBeNull();

    const log = await newBrewLog(owner, ws.id, await newBean(owner, ws.id), { problemIds: [fast] });
    expect((await owner.agent.get(`${base}/${fast}/usage`)).body).toEqual({ brewLogCount: 1 });
    expect((await owner.agent.delete(`${base}/${fast}`)).status).toBe(204);
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/brew-logs/${log}`)).body.brewLog.problems).toEqual([]);
    expect((await owner.agent.delete(`${base}/${fast}`)).status).toBe(404);
  });

  it("viewers read only; outsiders get 404", async () => {
    const { owner, ws, base, byName } = await setup();
    const viewer = await newUser();
    const outsider = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    const tared = await byName("Scale not tared");
    expect((await viewer.agent.get(base)).status).toBe(200);
    expect((await viewer.agent.post(base).send({ name: "x" })).status).toBe(403);
    expect((await viewer.agent.patch(`${base}/${tared}`).send({ archived: true })).status).toBe(403);
    expect((await viewer.agent.put(`${base}/order`).send({ problemIds: [tared] })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/${tared}`)).status).toBe(403);
    expect((await outsider.agent.get(base)).status).toBe(404);
  });
});

describe("brew logs with problems", () => {
  it("record problems in list order, replace them on PATCH, accept archived ones", async () => {
    const { owner, ws, base, byName } = await setup();
    const bean = await newBean(owner, ws.id);
    const logs = `/api/workspaces/${ws.id}/brew-logs`;
    const [tared, slow, walls] = [await byName("Scale not tared"), await byName("Slow drawdown / stalled bed"), await byName("Grounds high on the walls")];

    const id = await newBrewLog(owner, ws.id, bean, { problemIds: [tared, slow] });
    const log = (await owner.agent.get(`${logs}/${id}`)).body.brewLog;
    expect(log.problems.map((p: Problem) => p.name)).toEqual(["Slow drawdown / stalled bed", "Scale not tared"]); // list order
    expect(log.problems[0]).toEqual({ id: slow, name: "Slow drawdown / stalled bed", methodKind: "filter" });

    await owner.agent.patch(`${base}/${walls}`).send({ archived: true });
    const replaced = await owner.agent.patch(`${logs}/${id}`).send({ problemIds: [walls] });
    expect(replaced.status).toBe(200);
    expect(replaced.body.brewLog.problems.map((p: Problem) => p.name)).toEqual(["Grounds high on the walls"]);

    // Other fields leave the problems alone; [] clears them.
    expect((await owner.agent.patch(`${logs}/${id}`).send({ rating: 4 })).body.brewLog.problems).toHaveLength(1);
    expect((await owner.agent.patch(`${logs}/${id}`).send({ problemIds: [] })).body.brewLog.problems).toEqual([]);
    expect((await owner.agent.get(logs)).body.brewLogs[0].problems).toEqual([]);
  });

  it("reject another workspace's problems and duplicates", async () => {
    const { owner, ws, byName } = await setup();
    const bean = await newBean(owner, ws.id);
    const logs = `/api/workspaces/${ws.id}/brew-logs`;
    const other = await setup();
    const theirs = await other.byName("Scale not tared");
    const send = (problemIds: string[]) =>
      owner.agent.post(logs).send({ beanId: bean, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, problemIds });
    const foreign = await send([theirs]);
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toMatch(/problemIds/);
    const tared = await byName("Scale not tared");
    expect((await send([tared, tared])).status).toBe(400);
  });
});
