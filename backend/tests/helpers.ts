import request from "supertest";
import { expect } from "vitest";
import { app } from "../src/app.js";

export type Agent = ReturnType<typeof request.agent>;

export interface TestUser {
  agent: Agent; // keeps the session cookie between requests
  id: string;
  email: string;
  password: string;
}

let counter = 0;

export async function newUser(name = "user"): Promise<TestUser> {
  counter += 1;
  const email = `${name}${counter}@example.com`;
  const password = "correct-horse-battery";
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ email, password });
  expect(res.status).toBe(201);
  return { agent, id: res.body.user.id as string, email, password };
}

export function anonymous(): Agent {
  return request.agent(app);
}

export async function newWorkspace(owner: TestUser, slug = `ws-${++counter}`): Promise<{ id: string; slug: string }> {
  const res = await owner.agent.post("/api/workspaces").send({ name: `Workspace ${slug}`, slug });
  expect(res.status).toBe(201);
  return { id: res.body.workspace.id as string, slug };
}

export async function addMember(owner: TestUser, workspaceId: string, user: TestUser, role: string): Promise<void> {
  const res = await owner.agent.post(`/api/workspaces/${workspaceId}/members`).send({ email: user.email, role });
  expect(res.status).toBe(201);
}

export async function brewerId(user: TestUser, workspaceId: string, name: string): Promise<string> {
  const res = await user.agent.get(`/api/workspaces/${workspaceId}/brewers`);
  const method = (res.body.brewers as Array<{ id: string; name: string }>).find((m) => m.name === name);
  if (!method) throw new Error(`No brew method ${name}`);
  return method.id;
}

export async function newBean(user: TestUser, workspaceId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const res = await user.agent
    .post(`/api/workspaces/${workspaceId}/beans`)
    .send({ roasterName: "Onyx", beanName: "Southern Weather", ...fields });
  expect(res.status).toBe(201);
  return res.body.bean.id as string;
}

export async function newBrewLog(user: TestUser, workspaceId: string, beanId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const res = await user.agent
    .post(`/api/workspaces/${workspaceId}/brew-logs`)
    .send({ beanId, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, ...fields });
  expect(res.status).toBe(201);
  return res.body.brewLog.id as string;
}

// Menu builder (docs/api/menu.md §7b): a section, returning its id.
export async function menuSection(user: TestUser, workspaceId: string, name: string): Promise<string> {
  const res = await user.agent.post(`/api/workspaces/${workspaceId}/menu/sections`).send({ name });
  expect(res.status).toBe(201);
  const section = (res.body.sections as Array<{ id: string; name: string }>).find((s) => s.name === name);
  return section!.id;
}

export async function menuAdd(user: TestUser, workspaceId: string, sectionId: string, item: Record<string, unknown>): Promise<void> {
  const res = await user.agent.post(`/api/workspaces/${workspaceId}/menu/sections/${sectionId}/items`).send(item);
  expect(res.status).toBe(201);
}

// Turns the menu on with a "Coffee" section holding the beans block.
export async function menuWithBeans(user: TestUser, workspaceId: string): Promise<void> {
  await user.agent.patch(`/api/workspaces/${workspaceId}`).send({ isPublicMenuEnabled: true });
  await menuAdd(user, workspaceId, await menuSection(user, workspaceId, "Coffee"), { itemType: "beans" });
}

// The beans listed on the public menu, wherever the beans block is.
export async function publicMenuBeans(slug: string): Promise<Array<Record<string, unknown>>> {
  const res = await request(app).get(`/api/public/menu/${slug}`);
  if (res.status !== 200) return [];
  return (res.body.sections as Array<{ items: Array<{ type: string; beans?: Array<Record<string, unknown>> }> }>).flatMap((s) =>
    s.items.flatMap((i) => (i.type === "beans" ? (i.beans ?? []) : []))
  );
}

// The id of one of the workspace's built-in processes, e.g. "washed" (§4b).
export async function processId(user: TestUser, workspaceId: string, builtin: string): Promise<string> {
  const res = await user.agent.get(`/api/workspaces/${workspaceId}/bean-processes`);
  const row = (res.body.processes as Array<{ id: string; builtin: string | null }>).find((p) => p.builtin === builtin);
  if (!row) throw new Error(`No built-in process ${builtin}`);
  return row.id;
}

// The id of one of the workspace's built-in recipe styles for a method, e.g.
// ("filter", "pour_over") (docs/api/recipe-styles.md §5e).
export async function styleId(user: TestUser, workspaceId: string, kind: string, builtin: string): Promise<string> {
  const res = await user.agent.get(`/api/workspaces/${workspaceId}/recipe-styles`);
  const row = (res.body.styles as Array<{ id: string; kind: string; builtin: string | null }>).find((s) => s.kind === kind && s.builtin === builtin);
  if (!row) throw new Error(`No built-in ${kind} style ${builtin}`);
  return row.id;
}
