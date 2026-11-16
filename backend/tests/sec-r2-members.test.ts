// Security audit round 2, members: SEC-03 (removal doesn't reach an open reply stream).
import { CHAT_EVENT_FIELD, chatReplyKey, type ChatStreamEvent } from "@barista/shared/jobs";
import { workspaceAiConfigs } from "@barista/shared/schema";
import { Redis } from "ioredis";
import { afterAll, expect, it } from "vitest";
import { config } from "../src/config.js";
import { db } from "../src/db.js";
import { addMember, newUser, newWorkspace } from "./helpers.js";

// The worker's part is played by the test: it writes reply pieces to Redis.
const redis = new Redis(config.redis.url, { ...(config.redis.password ? { password: config.redis.password } : {}) });
afterAll(() => redis.disconnect());
const publish = (messageId: string, event: ChatStreamEvent) => redis.xadd(chatReplyKey(messageId), "*", CHAT_EVENT_FIELD, JSON.stringify(event));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// SEC-03: a member removed while their AI reply streams keeps receiving it.
it("SEC-03 removing a member ends their open reply stream before the next piece", async () => {
  const owner = await newUser("owner");
  const member = await newUser("member");
  const workspaceId = (await newWorkspace(owner)).id;
  await db.insert(workspaceAiConfigs).values({ workspaceId, provider: "openai", apiKeyEncrypted: "x", apiKeyLast4: "1234", model: "m" });
  await addMember(owner, workspaceId, member, "barista");

  const start = await member.agent.post(`/api/workspaces/${workspaceId}/chats`).send({ content: "Hi" });
  expect(start.status, JSON.stringify(start.body)).toBe(202);
  const chatId = start.body.chat.id as string;
  const reply = start.body.messages[1].id as string;

  // The member's stream is open and waiting on Redis when they are removed
  // (.then() sends the request now; a supertest request is otherwise lazy).
  const stream = member.agent
    .get(`/api/workspaces/${workspaceId}/chats/${chatId}/messages/${reply}/stream`)
    .buffer(true)
    .parse((r, done) => {
      let body = "";
      r.on("data", (c: Buffer) => (body += c.toString()));
      r.on("end", () => done(null, body));
    })
    .then((r) => r);
  await sleep(300);
  expect((await owner.agent.delete(`/api/workspaces/${workspaceId}/members/${member.id}`)).status).toBe(204);
  await sleep(1100); // the stream looks for removal about once a second
  await publish(reply, { type: "text", text: "AFTER-REMOVAL" });
  await publish(reply, { type: "end" });

  const res = await stream;
  expect(res.status).toBe(200);
  expect(res.body as string).not.toContain("AFTER-REMOVAL");
});
