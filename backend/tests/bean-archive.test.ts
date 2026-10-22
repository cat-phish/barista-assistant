import { describe, expect, it } from "vitest";
import { menuWithBeans, newBean, newUser, newWorkspace, publicMenuBeans } from "./helpers.js";

async function setup() {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const id = await newBean(owner, ws.id);
  const bean = `/api/workspaces/${ws.id}/beans/${id}`;
  return { owner, ws, bean };
}

describe("archiving beans (docs/api/beans.md §4)", () => {
  it("returns createdAt, and new beans are active", async () => {
    const { owner, ws } = await setup();
    const [bean] = (await owner.agent.get(`/api/workspaces/${ws.id}/beans`)).body.beans;
    expect(bean.archivedAt).toBeNull();
    expect(Date.now() - new Date(bean.createdAt).getTime()).toBeLessThan(60_000);
  });

  it("archives with the first date kept, and unarchives", async () => {
    const { owner, ws, bean } = await setup();
    const archived = await owner.agent.patch(bean).send({ archived: true });
    expect(archived.status).toBe(200);
    const first = archived.body.bean.archivedAt;
    expect(first).toEqual(expect.any(String));

    // Archiving again (or editing) keeps the original date.
    expect((await owner.agent.patch(bean).send({ archived: true, notes: "Done" })).body.bean.archivedAt).toBe(first);
    // Archived beans are still listed.
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/beans`)).body.beans).toHaveLength(1);

    expect((await owner.agent.patch(bean).send({ archived: false })).body.bean.archivedAt).toBeNull();
  });

  it("archives and rates in one request", async () => {
    const { owner, bean } = await setup();
    const res = await owner.agent.patch(bean).send({ archived: true, rating: 4 });
    expect(res.body.bean).toMatchObject({ rating: 4, archivedAt: expect.any(String) });
  });

  it("creates beans active and rejects non-boolean values", async () => {
    const { owner, ws, bean } = await setup();
    // POST doesn't take archived (unknown keys are dropped there): new beans are active.
    const created = await owner.agent.post(`/api/workspaces/${ws.id}/beans`).send({ roasterName: "Onyx", beanName: "New", archived: true });
    expect(created.body.bean.archivedAt).toBeNull();
    expect((await owner.agent.patch(bean).send({ archived: "yes" })).status).toBe(400);
    expect((await owner.agent.patch(bean).send({ archivedAt: null })).status).toBe(400);
  });

  it("leaves the public menu while archived", async () => {
    const { owner, ws, bean } = await setup();
    await menuWithBeans(owner, ws.id);
    const menuBeans = () => publicMenuBeans(ws.slug);
    expect(await menuBeans()).toHaveLength(1);
    await owner.agent.patch(bean).send({ archived: true });
    expect(await menuBeans()).toHaveLength(0);
    await owner.agent.patch(bean).send({ archived: false });
    expect(await menuBeans()).toHaveLength(1);
  });
});
