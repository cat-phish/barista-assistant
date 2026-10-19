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

export async function methodId(user: TestUser, workspaceId: string, name: string): Promise<string> {
  const res = await user.agent.get(`/api/workspaces/${workspaceId}/brew-methods`);
  const method = (res.body.brewMethods as Array<{ id: string; name: string }>).find((m) => m.name === name);
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
    .send({ beanId, actualDoseGrams: 15, actualYieldGrams: 250, actualTimeSec: 150, ...fields });
  expect(res.status).toBe(201);
  return res.body.brewLog.id as string;
}
