import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notes } from "@barista/shared/schema";
import { db } from "../src/db.js";
import { MAX_NOTE_BODY } from "../src/routes/notes.js";
import { addMember, newUser, newWorkspace } from "./helpers.js";

interface Note {
  id: string;
  title: string;
  body: string;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const base = `/api/workspaces/${ws.id}/notes`;
  const list = async () => (await owner.agent.get(base)).body.notes as Note[];
  const add = async (title: string, body?: string) => {
    const res = await owner.agent.post(base).send({ title, ...(body === undefined ? {} : { body }) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.note as Note;
  };
  return { owner, ws, base, list, add };
}

// Timestamps have whole seconds: set them so the order doesn't depend on timing.
const setTimes = (id: string, times: { updatedAt?: Date; pinnedAt?: Date | null }) => db.update(notes).set(times).where(eq(notes.id, id));

describe("notes (docs/api/notes.md §3h)", () => {
  it("a new workspace has none", async () => {
    const { list } = await setup();
    expect(await list()).toEqual([]);
  });

  it("add, edit and delete; titles trimmed and unique; values checked", async () => {
    const { owner, base, list, add } = await setup();
    const created = await add("  Descaling the kettle ", "- 20 g citric acid per 1 L\n\n  indented line");
    expect(created).toMatchObject({ title: "Descaling the kettle", body: "- 20 g citric acid per 1 L\n\n  indented line", pinnedAt: null });
    expect(typeof created.createdAt).toBe("string");
    expect((await add("Burr cleaning")).body).toBe("");

    expect((await owner.agent.post(base).send({ title: "descaling THE kettle" })).status).toBe(409);
    expect((await owner.agent.post(base).send({ title: "   " })).status).toBe(400);
    expect((await owner.agent.post(base).send({ title: "x".repeat(101) })).status).toBe(400);
    expect((await owner.agent.post(base).send({ title: "Long", body: "x".repeat(MAX_NOTE_BODY + 1) })).status).toBe(400);
    expect((await owner.agent.post(base).send({ title: "Long", body: "x".repeat(MAX_NOTE_BODY) })).status).toBe(201);
    expect((await owner.agent.post(base).send({ title: "Extra", pinned: true })).status).toBe(400);

    const changed = await owner.agent.patch(`${base}/${created.id}`).send({ title: "Kettle descaling", body: "Every month" });
    expect(changed.status).toBe(200);
    expect(changed.body.note).toMatchObject({ id: created.id, title: "Kettle descaling", body: "Every month" });
    // The same values again is fine, not "not found".
    expect((await owner.agent.patch(`${base}/${created.id}`).send({ body: "Every month" })).status).toBe(200);
    expect((await owner.agent.patch(`${base}/${created.id}`).send({ title: "burr CLEANING" })).status).toBe(409);
    expect((await owner.agent.patch(`${base}/${created.id}`).send({})).status).toBe(400);
    expect((await owner.agent.patch(`${base}/${created.id}`).send({ color: "red" })).status).toBe(400);

    expect((await owner.agent.delete(`${base}/${created.id}`)).status).toBe(204);
    expect((await owner.agent.delete(`${base}/${created.id}`)).status).toBe(404);
    expect((await owner.agent.patch(`${base}/${created.id}`).send({ body: "x" })).status).toBe(404);
    expect((await list()).map((n) => n.title).sort()).toEqual(["Burr cleaning", "Long"]);
  });

  it("pinned first, most recently pinned first; then most recently changed", async () => {
    const { owner, base, list, add } = await setup();
    const [a, b, c, d] = [await add("A"), await add("B"), await add("C"), await add("D")];
    await setTimes(a.id, { updatedAt: new Date("2026-01-01T00:00:00Z") });
    await setTimes(b.id, { updatedAt: new Date("2026-03-01T00:00:00Z") });
    await setTimes(c.id, { updatedAt: new Date("2026-02-01T00:00:00Z"), pinnedAt: new Date("2026-04-01T00:00:00Z") });
    await setTimes(d.id, { updatedAt: new Date("2026-01-15T00:00:00Z"), pinnedAt: new Date("2026-05-01T00:00:00Z") });
    expect((await list()).map((n) => n.title)).toEqual(["D", "C", "B", "A"]);

    // Pinning again keeps its date; unpinning clears it.
    const again = await owner.agent.patch(`${base}/${d.id}`).send({ pinned: true });
    expect(again.body.note.pinnedAt).toBe(new Date("2026-05-01T00:00:00Z").toISOString());
    const pinned = await owner.agent.patch(`${base}/${a.id}`).send({ pinned: true });
    expect(pinned.body.note.pinnedAt).not.toBeNull();
    expect((await list()).map((n) => n.title)).toEqual(["A", "D", "C", "B"]);
    const unpinned = await owner.agent.patch(`${base}/${d.id}`).send({ pinned: false });
    expect(unpinned.body.note.pinnedAt).toBeNull();
    expect((await list()).map((n) => n.title).slice(0, 2)).toEqual(["A", "C"]);
  });

  it("viewers read only; outsiders and other workspaces get 404", async () => {
    const { owner, ws, base, add } = await setup();
    const note = await add("Descaling");
    const viewer = await newUser();
    await addMember(owner, ws.id, viewer, "viewer");
    expect((await viewer.agent.get(base)).body.notes).toHaveLength(1);
    expect((await viewer.agent.post(base).send({ title: "x" })).status).toBe(403);
    expect((await viewer.agent.patch(`${base}/${note.id}`).send({ pinned: true })).status).toBe(403);
    expect((await viewer.agent.delete(`${base}/${note.id}`)).status).toBe(403);

    const barista = await newUser();
    await addMember(owner, ws.id, barista, "barista");
    expect((await barista.agent.patch(`${base}/${note.id}`).send({ pinned: true })).status).toBe(200);

    const outsider = await newUser();
    expect((await outsider.agent.get(base)).status).toBe(404);
    const other = await newWorkspace(outsider);
    const otherBase = `/api/workspaces/${other.id}/notes`;
    expect((await outsider.agent.patch(`${otherBase}/${note.id}`).send({ body: "x" })).status).toBe(404);
    expect((await outsider.agent.delete(`${otherBase}/${note.id}`)).status).toBe(404);
  });

  it("go with their workspace", async () => {
    const { owner, ws, add } = await setup();
    const note = await add("Descaling");
    expect((await owner.agent.delete(`/api/workspaces/${ws.id}?confirm=${ws.slug}`)).status).toBeLessThan(300);
    expect(await db.select().from(notes).where(eq(notes.id, note.id))).toEqual([]);
  });
});
