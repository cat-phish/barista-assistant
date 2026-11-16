import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { EMPTY_AI_PREFERENCES, type AiPreferences } from "@barista/shared/aiPreferences";
import { preferencesJobId } from "@barista/shared/jobs";
import { parameterSuggestions, users } from "@barista/shared/schema";
import { db } from "../src/db.js";
import { preferencesQueue } from "../src/queue.js";
import { addMember, brewerId, newBean, newUser, newWorkspace } from "./helpers.js";

// Learned preferences (docs/api/auth.md §1d).
const URL = "/api/auth/me/ai-preferences";
const stored = async (userId: string) => (await db.select({ p: users.aiPreferences }).from(users).where(eq(users.id, userId)))[0]!.p;
const seed = (userId: string, p: Partial<AiPreferences>) => db.update(users).set({ aiPreferences: { ...EMPTY_AI_PREFERENCES, ...p } }).where(eq(users.id, userId));
const NOW = "2026-11-14T10:00:00.000Z";

describe("learned preferences", () => {
  it("start empty with the defaults, and saves the person's own list", async () => {
    const me = await newUser();
    const res = await me.agent.get(URL);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aiPreferences: EMPTY_AI_PREFERENCES, limits: { items: 20, text: 200 } });

    await seed(me.id, {
      items: [{ id: "a", text: "Prefers 19-20% EY", basis: 6, source: "ai", updatedAt: NOW }, { id: "b", text: "Likes long blooms", basis: 2, source: "ai", updatedAt: NOW }],
      proposals: [{ id: "x", change: "remove", targetId: "b", text: null, basis: 3, why: "w", createdAt: NOW }],
    });
    const put = await me.agent.put(URL).send({ learn: "manual", apply: "apply", items: [{ id: "a", text: "Prefers 19-20% EY" }, { text: "  No cooler water " }] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const p = put.body.aiPreferences as AiPreferences;
    expect(p).toMatchObject({ learn: "manual", apply: "apply" });
    // Unchanged keeps its basis; new is the person's; the removed one's proposal goes.
    expect(p.items[0]).toEqual({ id: "a", text: "Prefers 19-20% EY", basis: 6, source: "ai", updatedAt: NOW });
    expect(p.items[1]).toMatchObject({ text: "No cooler water", basis: 0, source: "person" });
    expect(p.proposals).toEqual([]);
    expect(await stored(me.id)).toEqual(p);

    for (const bad of [
      { learn: "auto", apply: "propose", items: [{ id: "nope", text: "x" }] },
      { learn: "auto", apply: "propose", items: [{ text: "" }] },
      { learn: "auto", apply: "propose", items: [{ text: "x".repeat(201) }] },
      { learn: "auto", apply: "propose", items: Array.from({ length: 21 }, (_, i) => ({ text: `L${i}` })) },
      { learn: "sometimes", apply: "propose", items: [] },
      { learn: "auto", apply: "propose", items: [], extra: 1 },
    ]) {
      expect((await me.agent.put(URL).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("accepts or dismisses the AI's proposals", async () => {
    const me = await newUser();
    await seed(me.id, {
      items: [{ id: "a", text: "Prefers 19-20% EY", basis: 6, source: "ai", updatedAt: NOW }],
      proposals: [
        { id: "p1", change: "edit", targetId: "a", text: "Prefers 20-21% EY", basis: 8, why: "w", createdAt: NOW },
        { id: "p2", change: "add", targetId: null, text: "Turns down cooler water", basis: 2, why: "w", createdAt: NOW },
      ],
    });
    let res = await me.agent.post(`${URL}/proposals/p1/accept`);
    expect(res.status).toBe(200);
    expect(res.body.aiPreferences.items).toEqual([expect.objectContaining({ id: "a", text: "Prefers 20-21% EY", basis: 8 })]);
    res = await me.agent.post(`${URL}/proposals/p2/dismiss`);
    expect(res.body.aiPreferences).toMatchObject({ items: [expect.objectContaining({ id: "a" })], proposals: [] });
    expect((await me.agent.post(`${URL}/proposals/p2/accept`)).status).toBe(404);
    expect((await me.agent.post(`${URL}/proposals/p2/maybe`)).status).toBe(404);
  });

  it("a like or dislike queues learning when it's automatic; Update now queues it either way", async () => {
    const owner = await newUser("owner");
    const viewer = await newUser("viewer");
    const ws = (await newWorkspace(owner)).id;
    await addMember(owner, ws, viewer, "viewer");
    const bean = await newBean(owner, ws);
    const v60 = await brewerId(owner, ws, "V60");
    const base = `/api/workspaces/${ws}/parameter-suggestions`;
    const id = (await owner.agent.post(base).send({ beanId: bean, brewerId: v60, source: "bean" })).body.suggestion.id as string;
    await db.update(parameterSuggestions).set({ status: "done", routes: [{ label: "Finer", why: "w", findings: [], grindSetting: 19, grindRpm: null, tempC: null, ratio: null }] }).where(eq(parameterSuggestions.id, id));
    const jobId = preferencesJobId(owner.id, ws);
    await preferencesQueue.remove(jobId);

    await seed(owner.id, { learn: "manual" });
    expect((await owner.agent.put(`${base}/${id}/feedback`).send({ route: 0, vote: "down" })).status).toBe(200);
    expect(await preferencesQueue.getJob(jobId)).toBeUndefined();
    const [row] = await db.select({ at: parameterSuggestions.feedbackAt }).from(parameterSuggestions).where(eq(parameterSuggestions.id, id));
    expect(row!.at).toBeInstanceOf(Date);

    await seed(owner.id, { learn: "auto" });
    await owner.agent.put(`${base}/${id}/feedback`).send({ route: 0, vote: "up" });
    expect((await preferencesQueue.getJob(jobId))?.data).toEqual({ userId: owner.id, workspaceId: ws });
    await preferencesQueue.remove(jobId);

    // Update now: queued; viewers can't; a workspace that keeps them from the AI refuses.
    const update = `/api/workspaces/${ws}/ai-preferences/update`;
    expect((await owner.agent.post(update)).status).toBe(202);
    expect(await preferencesQueue.getJob(jobId)).toBeDefined();
    await preferencesQueue.remove(jobId);
    expect((await viewer.agent.post(update)).status).toBe(403);
    // Learn about me off: no votes (taking one back is fine) and no Update now.
    expect((await owner.agent.patch("/api/auth/me/preferences").send({ learnAboutMe: false })).status).toBe(200);
    expect((await owner.agent.put(`${base}/${id}/feedback`).send({ route: 0, vote: "down" })).status).toBe(409);
    expect((await owner.agent.put(`${base}/${id}/feedback`).send({ route: 0, vote: null })).status).toBe(200);
    expect((await owner.agent.post(update)).status).toBe(409);
    await owner.agent.patch("/api/auth/me/preferences").send({ learnAboutMe: true });
    expect((await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ aiHidden: ["learnedPreferences"] })).status).toBe(200);
    expect((await owner.agent.post(update)).status).toBe(409);
    await owner.agent.put(`${base}/${id}/feedback`).send({ route: 0, vote: "down" });
    expect(await preferencesQueue.getJob(jobId)).toBeUndefined();
  });

  it("the workspace's own lines are a setting", async () => {
    const owner = await newUser("owner");
    const ws = (await newWorkspace(owner)).id;
    const res = await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ aiPreferences: [" Decaf after 3pm "] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.settings.aiPreferences).toEqual(["Decaf after 3pm"]);
    expect((await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ aiPreferences: [""] })).status).toBe(400);
    expect((await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ aiPreferences: Array.from({ length: 21 }, () => "x") })).status).toBe(400);
  });
});
