// SEC-61: a person can only be in so many workspaces.
import { expect, it, vi } from "vitest";
import { newUser } from "./helpers.js";

vi.hoisted(() => {
  process.env.MAX_OWNED_WORKSPACES = "3";
});

it("the 4th workspace is refused with 409 workspace_limit", async () => {
  const me = await newUser();
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await me.agent.post("/api/workspaces").send({ name: `W${i}`, slug: `cap-ws-${i}-x` })).status);
  expect(codes).toEqual([201, 201, 201, 409]);
});
