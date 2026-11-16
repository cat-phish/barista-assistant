import { randomUUID } from "node:crypto";
import { users, workspaces } from "@barista/shared/schema";
import { describe, expect, it } from "vitest";
import { db } from "../src/db.js";
import { experimentFindings, loadResearch } from "../src/research.js";

// Research settings as the worker loads them (docs/api/research.md §1f).
const finding = (id: string, mode: "on" | "off" | "experiment") => ({ id, title: "T", text: `Finding ${id}.`, levers: ["grind" as const], evidence: "own" as const, scope: "any" as const, source: null, mode, createdAt: "2026-11-01T00:00:00.000Z" });

describe("loadResearch", () => {
  it("merges the person's settings over the workspace's, with their findings first and private", async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, passwordHash: "x", research: { settings: { sourStrong: { mode: "on", note: "keep" } }, own: [finding("aaaaaaaa", "on")], seenVersion: null } });
    await db.insert(workspaces).values({ id: workspaceId, name: "Bar", slug: workspaceId, research: { settings: { sourStrong: { mode: "off", note: null }, bloom: { mode: "experiment", note: null } }, own: [finding("bbbbbbbb", "experiment"), finding("cccccccc", "off")] } });

    const r = await loadResearch(userId, workspaceId);
    expect(r.builtIn).toMatchObject({ sourStrong: "on", bloom: "experiment", leverOrder: "on", coldBloom: "experiment" });
    expect(r.own.map((f) => [f.id, f.private, f.mode])).toEqual([["aaaaaaaa", true, "on"], ["bbbbbbbb", false, "experiment"]]);
    expect(r.customized).toBe(true);
    expect(experimentFindings(r)).toEqual({ builtIn: ["bloom", "coldBloom", "firstPours"], own: [expect.objectContaining({ id: "bbbbbbbb" })] });

    // Nobody (a deleted account): the workspace's alone. Nothing stored: the defaults.
    expect((await loadResearch(null, workspaceId)).builtIn.sourStrong).toBe("off");
    const plain = randomUUID();
    await db.insert(workspaces).values({ id: plain, name: "Plain", slug: plain });
    expect(await loadResearch(null, plain)).toMatchObject({ builtIn: { sourStrong: "on", coldBloom: "experiment" }, own: [], customized: false });
  });
});
