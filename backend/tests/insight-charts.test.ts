import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addMember, newUser, newWorkspace } from "./helpers.js";

const explore = (fields: Record<string, unknown> = {}) => ({ id: randomUUID(), kind: "explore", tab: "brews", x: "tds", y: "rating", ...fields });
// 0 → "a", 26 → "ba": distinct letters-only ids.
const letters = (n: number): string => (n < 26 ? "" : letters(Math.floor(n / 26))) + String.fromCharCode(97 + (n % 26));
const builtIn = (chart: string) => ({ id: randomUUID(), kind: "chart", tab: "overview", chart });

describe("added Insights charts (docs/api/stats.md §11b)", () => {
  it("starts empty and keeps what's saved, in order", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const url = `/api/workspaces/${ws.id}/stats/charts`;
    expect((await owner.agent.get(url)).body).toMatchObject({ charts: [] });

    const charts = [explore({ color: "process", grinder: randomUUID() }), builtIn("brews.rating"), explore({ tab: "overview", x: "roastAge" })];
    const put = await owner.agent.put(url).send({ charts });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ charts });
    expect((await owner.agent.get(url)).body).toMatchObject({ charts });

    expect((await owner.agent.put(url).send({ charts: [] })).status).toBe(200);
    expect((await owner.agent.get(url)).body).toMatchObject({ charts: [] });
  });

  it("is each person's own, and a viewer can keep theirs", async () => {
    const owner = await newUser();
    const viewer = await newUser();
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, viewer, "viewer");
    const url = `/api/workspaces/${ws.id}/stats/charts`;
    const mine = [builtIn("beans.spend")];
    expect((await owner.agent.put(url).send({ charts: mine })).status).toBe(200);

    expect((await viewer.agent.get(url)).body).toMatchObject({ charts: [] });
    const theirs = [explore()];
    expect((await viewer.agent.put(url).send({ charts: theirs })).status).toBe(200);
    expect((await viewer.agent.get(url)).body).toMatchObject({ charts: theirs });
    expect((await owner.agent.get(url)).body).toMatchObject({ charts: mine });
  });

  it("refuses bad lists", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const url = `/api/workspaces/${ws.id}/stats/charts`;
    const same = explore();
    for (const charts of [
      [{ ...builtIn("brews.rating"), tab: "brews" }], // a built-in chart only goes on the Overview
      [explore({ tab: "explore" })],
      [explore({ x: "drop table" })],
      [explore({ extra: 1 })],
      [same, same],
      [builtIn("brews.rating"), builtIn("brews.rating")],
      Array.from({ length: 51 }, () => explore()),
    ]) {
      expect((await owner.agent.put(url).send({ charts })).status).toBe(400);
    }
    expect((await owner.agent.put(url).send({})).status).toBe(400);
  });

  it("keeps each person's layout: every tab's order and hidden charts", async () => {
    const owner = await newUser();
    const other = await newUser();
    const ws = await newWorkspace(owner);
    await addMember(owner, ws.id, other, "barista");
    const base = `/api/workspaces/${ws.id}/stats`;
    expect((await owner.agent.get(`${base}/charts`)).body.layout).toEqual({});

    const pin = `pin:${randomUUID()}`;
    const layout = { brews: { order: ["brews.rating", pin, "brews.total"], hidden: ["brews.problems"] }, overview: { order: ["tile.rating", "beans.spend"], hidden: ["tile.photos"], tilesBelow: true } };
    const put = await owner.agent.put(`${base}/layout`).send({ layout });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ layout });
    expect((await owner.agent.get(`${base}/charts`)).body.layout).toEqual(layout);
    expect((await other.agent.get(`${base}/charts`)).body.layout).toEqual({});

    expect((await owner.agent.put(`${base}/layout`).send({ layout: {} })).status).toBe(200);
    expect((await owner.agent.get(`${base}/charts`)).body.layout).toEqual({});
  });

  it("refuses bad layouts", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const url = `/api/workspaces/${ws.id}/stats/layout`;
    for (const layout of [
      { explore: { order: ["brews.rating"] } }, // not a layout tab
      { brews: { order: ["Brews rating"] } },
      { brews: { hidden: [`pin:${randomUUID()}`] } }, // an added chart is removed, not hidden
      { brews: { order: ["brews.rating", "brews.rating"] } },
      { brews: { order: [], extra: [] } },
      { overview: { tilesBelow: "yes" } },
      { brews: { order: Array.from({ length: 101 }, (_, i) => `brews.c${letters(i)}`) } }, // over 100
    ]) {
      expect((await owner.agent.put(url).send({ layout })).status).toBe(400);
    }
    expect((await owner.agent.put(url).send({})).status).toBe(400);
  });

  it("is 404 outside the workspace", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const ws = await newWorkspace(owner);
    const url = `/api/workspaces/${ws.id}/stats/charts`;
    expect((await stranger.agent.get(url)).status).toBe(404);
    expect((await stranger.agent.put(url).send({ charts: [] })).status).toBe(404);
    expect((await stranger.agent.put(`/api/workspaces/${ws.id}/stats/layout`).send({ layout: {} })).status).toBe(404);
  });
});
