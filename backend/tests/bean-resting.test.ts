import { describe, expect, it } from "vitest";
import { db } from "../src/db.js";
import { beans } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import { addMember, newBean, newUser, newWorkspace } from "./helpers.js";

// Resting beans (docs/api/beans.md §4, "Resting").
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const list = `/api/workspaces/${ws.id}/beans`;
  return { owner, ws, list };
}

describe("resting beans", () => {
  it("can be added resting; the brew picker box follows the adder's preference unless sent", async () => {
    const { owner, list } = await setup();
    const until = daysFromNow(10);
    const added = await owner.agent.post(list).send({ roasterName: "Onyx", beanName: "Geometry", restingUntil: until });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.bean).toMatchObject({ restingUntil: until, restingBy: owner.id, restInBrewPicker: true, restLastRemindedOn: null });

    await owner.agent.patch("/api/auth/me/preferences").send({ restingInBrewPickerDefault: false });
    expect((await owner.agent.post(list).send({ roasterName: "Onyx", beanName: "Monarch", restingUntil: until })).body.bean.restInBrewPicker).toBe(false);
    expect((await owner.agent.post(list).send({ roasterName: "Onyx", beanName: "Tropical", restingUntil: until, restInBrewPicker: true })).body.bean.restInBrewPicker).toBe(true);
    // An active bean isn't resting.
    expect((await owner.agent.post(list).send({ roasterName: "Onyx", beanName: "Active" })).body.bean).toMatchObject({ restingUntil: null, restingBy: null });
    expect((await owner.agent.post(list).send({ roasterName: "Onyx", beanName: "Bad", restingUntil: "soon" })).status).toBe(400);
  });

  it("rests and is made active by PATCH; a new day makes the editor the one reminded and starts over", async () => {
    const { owner, ws, list } = await setup();
    const barista = await newUser();
    await addMember(owner, ws.id, barista, "barista");
    const id = await newBean(owner, ws.id);
    const rest = await owner.agent.patch(`${list}/${id}`).send({ restingUntil: daysFromNow(3) });
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    expect(rest.body.bean).toMatchObject({ restingUntil: daysFromNow(3), restingBy: owner.id });

    await db.update(beans).set({ restLastRemindedOn: daysFromNow(0) }).where(eq(beans.id, id));
    // The same day again (a form save) changes nothing.
    const same = await barista.agent.patch(`${list}/${id}`).send({ restingUntil: daysFromNow(3), beanName: "Renamed" });
    expect(same.body.bean).toMatchObject({ restingBy: owner.id, restLastRemindedOn: daysFromNow(0) });
    const moved = await barista.agent.patch(`${list}/${id}`).send({ restingUntil: daysFromNow(5) });
    expect(moved.body.bean).toMatchObject({ restingUntil: daysFromNow(5), restingBy: barista.id, restLastRemindedOn: null });

    const active = await owner.agent.patch(`${list}/${id}`).send({ restingUntil: null });
    expect(active.body.bean).toMatchObject({ restingUntil: null, restingBy: null, restLastRemindedOn: null });
  });

  it("a frozen bean is active: it can't rest, and freezing a resting bean makes it active", async () => {
    const { owner, ws, list } = await setup();
    const id = await newBean(owner, ws.id);
    await owner.agent.patch(`${list}/${id}`).send({ restingUntil: daysFromNow(3) });
    const frozen = await owner.agent.post(`${list}/${id}/freeze`).send({});
    expect(frozen.status).toBe(200);
    expect(frozen.body.bean).toMatchObject({ frozen: true, restingUntil: null, restingBy: null });
    expect((await owner.agent.patch(`${list}/${id}`).send({ restingUntil: daysFromNow(3) })).status).toBe(409);
    await owner.agent.post(`${list}/${id}/thaw`).send({});
    expect((await owner.agent.patch(`${list}/${id}`).send({ restingUntil: daysFromNow(3) })).status).toBe(200);
  });

  it("archiving ends a rest, and an archived bean can't rest", async () => {
    const { owner, ws, list } = await setup();
    const id = await newBean(owner, ws.id);
    await owner.agent.patch(`${list}/${id}`).send({ restingUntil: daysFromNow(3) });
    const archived = await owner.agent.patch(`${list}/${id}`).send({ archived: true });
    expect(archived.body.bean).toMatchObject({ restingUntil: null, archivedAt: expect.any(String) });
    expect((await owner.agent.patch(`${list}/${id}`).send({ restingUntil: daysFromNow(3) })).status).toBe(400);
    expect((await owner.agent.patch(`${list}/${id}`).send({ archived: false, restingUntil: daysFromNow(3) })).status).toBe(200);
    expect((await owner.agent.patch(`${list}/${id}`).send({ archived: true, restingUntil: daysFromNow(3) })).status).toBe(400);
  });
});
