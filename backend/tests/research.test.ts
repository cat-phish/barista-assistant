import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { RESEARCH_FINDINGS, RESEARCH_VERSION } from "@barista/shared/research";
import { EMPTY_USER_RESEARCH, type OwnFinding, type UserResearch } from "@barista/shared/researchSettings";
import { users, workspaces } from "@barista/shared/schema";
import { db } from "../src/db.js";
import { cleanText } from "../src/research.js";
import { addMember, newUser, newWorkspace } from "./helpers.js";

// Research settings (docs/api/research.md §1f).
const URL = "/api/auth/me/research";
const finding = { title: "Slower pours", text: "Slower pours gave more sweetness on light roasts.", levers: ["agitation", "bloom"], evidence: "own", scope: "pourOver", source: "My notes, Oct 2026", mode: "on" };
const stored = async (userId: string) => (await db.select({ r: users.research }).from(users).where(eq(users.id, userId)))[0]!.r;

describe("research settings: mine", () => {
  it("starts with the defaults and the built-in list, then saves settings and own findings", async () => {
    const me = await newUser();
    let res = await me.agent.get(URL);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ research: EMPTY_USER_RESEARCH, version: RESEARCH_VERSION, updated: [], limits: { findings: 20, title: 80, text: 600, source: 300, note: 200 } });
    expect(res.body.builtIn.map((f: { key: string }) => f.key)).toEqual(RESEARCH_FINDINGS.map((f) => f.key));
    expect(res.body.builtIn[0]).toMatchObject({ key: "leverOrder", title: "Which lever to move", experiment: false, evidence: "peerReviewed", since: "r2" });

    res = await me.agent.put(URL).send({ settings: { sourStrong: { mode: "off", note: "  skews my\tV60 " }, coldBloom: { mode: "on" } }, own: [finding] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = res.body.research as UserResearch;
    expect(r.settings).toEqual({ sourStrong: { mode: "off", note: "skews my V60" }, coldBloom: { mode: "on", note: null } });
    expect(r.own).toHaveLength(1);
    const own = r.own[0]!;
    expect(own).toMatchObject({ ...finding, levers: ["agitation", "bloom"] });
    expect(own.id).toMatch(/^[0-9a-f]{8}$/);
    expect(own.createdAt).toMatch(/^\d{4}-/);
    expect(await stored(me.id)).toEqual(r);

    // An edit keeps the id and createdAt; a new one gets its own; an unknown id is refused.
    res = await me.agent.put(URL).send({ settings: {}, own: [{ ...finding, id: own.id, text: "Changed." }, { ...finding, title: "Another", source: null }] });
    expect(res.status).toBe(200);
    expect(res.body.research.own[0]).toMatchObject({ id: own.id, createdAt: own.createdAt, text: "Changed." });
    expect(res.body.research.own[1].id).not.toBe(own.id);
    expect((await me.agent.put(URL).send({ settings: {}, own: [{ ...finding, id: "0badf00d" }] })).status).toBe(400);
    // The person's set is theirs: another account doesn't see it.
    expect((await (await newUser("other")).agent.get(URL)).body.research.own).toEqual([]);
  });

  it("refuses what doesn't fit the schema", async () => {
    const me = await newUser();
    for (const bad of [
      { settings: { noSuchFinding: { mode: "off" } }, own: [] },
      { settings: { sourStrong: { mode: "sometimes" } }, own: [] },
      { settings: { sourStrong: { mode: "off", note: "n".repeat(201) } }, own: [] },
      { settings: {}, own: [{ ...finding, title: "" }] },
      { settings: {}, own: [{ ...finding, title: "t".repeat(81) }] },
      { settings: {}, own: [{ ...finding, text: "t".repeat(601) }] },
      { settings: {}, own: [{ ...finding, source: "s".repeat(301) }] },
      { settings: {}, own: [{ ...finding, levers: [] }] },
      { settings: {}, own: [{ ...finding, levers: ["flow"] }] },
      { settings: {}, own: [{ ...finding, evidence: "proof" }] },
      { settings: {}, own: [{ ...finding, scope: "cold" }] },
      { settings: {}, own: [{ ...finding, mode: "maybe" }] },
      { settings: {}, own: [{ ...finding, extra: 1 }] },
      { settings: {}, own: Array.from({ length: 21 }, () => finding) },
      { settings: {} },
      { settings: {}, own: [], more: true },
    ]) {
      expect((await me.agent.put(URL).send(bad)).status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    // Text that's all control characters is empty once cleaned.
    expect((await me.agent.put(URL).send({ settings: {}, own: [{ ...finding, text: "\u0000\u0007\n" }] })).status).toBe(400);
    expect(cleanText("a\u0000b\u001f  c d\r\ne")).toBe("a b c d e");
  });

  it("tells about findings reworded since the version last dismissed", async () => {
    const me = await newUser();
    // Never dismissed: nothing to compare with.
    expect((await me.agent.get(URL)).body.updated).toEqual([]);
    await db.update(users).set({ research: { ...EMPTY_USER_RESEARCH, seenVersion: "r1" } }).where(eq(users.id, me.id));
    const updated = (await me.agent.get(URL)).body.updated as string[];
    expect(updated).toEqual(RESEARCH_FINDINGS.filter((f) => f.since !== "r1").map((f) => f.key));
    const res = await me.agent.post(`${URL}/seen`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ research: { seenVersion: RESEARCH_VERSION }, updated: [] });
    // Saving settings keeps the version seen.
    await me.agent.put(URL).send({ settings: {}, own: [] });
    expect((await stored(me.id))!.seenVersion).toBe(RESEARCH_VERSION);
  });
});

describe("research settings: the workspace's", () => {
  it("owners set the defaults and shared findings, members read them", async () => {
    const owner = await newUser("owner");
    const ws = (await newWorkspace(owner)).id;
    const barista = await newUser("barista");
    await addMember(owner, ws, barista, "barista");
    const url = `/api/workspaces/${ws}/research`;
    expect((await barista.agent.get(url)).body).toEqual({ research: { settings: {}, own: [] }, limits: { findings: 20, title: 80, text: 600, source: 300, note: 200 } });
    expect((await barista.agent.put(url).send({ settings: {}, own: [finding] })).status).toBe(403);
    expect((await (await newUser("stranger")).agent.get(url)).status).toBe(404);

    const res = await owner.agent.put(url).send({ settings: { sourStrong: { mode: "off", note: null } }, own: [finding] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.research.settings).toEqual({ sourStrong: { mode: "off", note: null } });
    expect(res.body.research.own[0]).toMatchObject(finding);
    expect((await barista.agent.get(url)).body.research).toEqual(res.body.research);
    expect((await db.select({ r: workspaces.research }).from(workspaces).where(eq(workspaces.id, ws)))[0]!.r).toEqual(res.body.research);
    expect((await owner.agent.put(url).send({ settings: {}, own: Array.from({ length: 21 }, () => finding) })).status).toBe(400);
    // Unaffected: the owner's own research.
    expect((await owner.agent.get(URL)).body.research).toEqual(EMPTY_USER_RESEARCH);
  });

  it("goes with the workspace's backup, and a bad block is refused", async () => {
    const owner = await newUser("owner");
    const ws = (await newWorkspace(owner)).id;
    const url = `/api/workspaces/${ws}/research`;
    const saved = (await owner.agent.put(url).send({ settings: { bloom: { mode: "experiment", note: null } }, own: [finding] })).body.research as { settings: unknown; own: OwnFinding[] };
    await owner.agent.put(URL).send({ settings: {}, own: [{ ...finding, title: "Mine only" }] });
    const backup = (await owner.agent.get(`/api/workspaces/${ws}/backup`)).body;
    expect(backup.workspace.research).toEqual(saved);
    expect(JSON.stringify(backup)).not.toContain("Mine only"); // the person's stay with them

    const restore = (workspace: Record<string, unknown>, slug: string) => owner.agent.post("/api/workspaces/restore").send({ name: slug, slug, backup: { ...backup, workspace } });
    let res = await restore(backup.workspace, `${ws}-again`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await owner.agent.get(`/api/workspaces/${res.body.workspaceId}/research`)).body.research).toEqual(saved);
    // Left out or null (older files): none.
    const { research: _r, ...older } = backup.workspace;
    res = await restore(older, `${ws}-old`);
    expect(res.status).toBe(201);
    expect((await owner.agent.get(`/api/workspaces/${res.body.workspaceId}/research`)).body.research).toEqual({ settings: {}, own: [] });
    for (const bad of [{ settings: {}, own: [{ ...saved.own[0], text: "x".repeat(601) }] }, { settings: {}, own: [saved.own[0], saved.own[0]] }, { settings: { bloom: { mode: "loud", note: null } }, own: [] }, "research"]) {
      res = await restore({ ...backup.workspace, research: bad }, `${ws}-bad`);
      expect(res.status, JSON.stringify(bad).slice(0, 60)).toBe(400);
      expect(res.body.error).toMatch(/research/);
    }
  });
});
