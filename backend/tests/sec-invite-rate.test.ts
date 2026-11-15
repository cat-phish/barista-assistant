// SEC-01: inviting is rate-limited per person. Own file: counters are per file.
import { expect, it, vi } from "vitest";
import { newUser, newWorkspace } from "./helpers.js";

vi.hoisted(() => {
  process.env.INVITE_LIMIT_PER_HOUR = "5";
});

it("the 6th invite in an hour is 429", async () => {
  const owner = await newUser();
  const ws = await newWorkspace(owner);
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await owner.agent.post(`/api/workspaces/${ws.id}/members`).send({ email: `r${i}@example.com`, role: "viewer" })).status);
  expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
});
