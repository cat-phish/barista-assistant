import { afterEach, describe, expect, it, vi } from "vitest";
import { rateReminderJobId } from "@barista/shared/jobs";
import { reminderQueue } from "../src/queue.js";
import { anonymous, newBean, newUser, newWorkspace } from "./helpers.js";

// docs/api/notifications.md §1b
const BASE = "/api/auth/me/notifications";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notification channels", () => {
  it("are per person: set up, list with secrets masked, switch off, remove", async () => {
    const me = await newUser();
    const other = await newUser();
    expect((await me.agent.get(BASE)).body.channels).toEqual([]);

    const saved = await me.agent.put(`${BASE}/ntfy`).send({ config: { topic: "my-coffee", token: "fake-token-1234" } });
    expect(saved.status).toBe(200);
    expect(saved.body.channel).toMatchObject({ kind: "ntfy", enabled: true, config: { server: "https://ntfy.sh", topic: "my-coffee", token: "••••1234" } });
    await me.agent.put(`${BASE}/discord`).send({ enabled: false, config: { url: "https://discord.com/api/webhooks/1/secret-part-9999" } });

    const list = (await me.agent.get(BASE)).body.channels;
    expect(list.map((c: { kind: string; enabled: boolean }) => [c.kind, c.enabled])).toEqual([["ntfy", true], ["discord", false]]);
    expect(list[1].config.url).toBe("••••9999");
    expect((await other.agent.get(BASE)).body.channels).toEqual([]); // nobody else's

    expect((await me.agent.delete(`${BASE}/discord`)).status).toBe(204);
    expect((await me.agent.delete(`${BASE}/discord`)).status).toBe(404);
    expect((await anonymous().get(BASE)).status).toBe(401);
  });

  it("sending a masked secret back keeps the stored one; a new value replaces it", async () => {
    const me = await newUser();
    await me.agent.put(`${BASE}/pushover`).send({ config: { userKey: "fake-user-key-0001", appToken: "fake-app-token-0002" } });
    const masked = (await me.agent.get(BASE)).body.channels[0].config;
    const again = await me.agent.put(`${BASE}/pushover`).send({ enabled: false, config: masked });
    expect(again.status).toBe(200);
    expect(again.body.channel).toMatchObject({ enabled: false, config: masked });

    let sent: unknown = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ((sent = JSON.parse(String(init.body))), new Response(null, { status: 200 }))));
    expect((await me.agent.post(`${BASE}/pushover/test`)).status).toBe(204);
    expect(sent).toMatchObject({ user: "fake-user-key-0001", token: "fake-app-token-0002", title: "Test from Barista" });
  });

  it("validates each service's settings", async () => {
    const me = await newUser();
    for (const [kind, config] of [
      ["ntfy", { topic: "has spaces" }],
      ["ntfy", { server: "ftp://ntfy.example", topic: "ok" }],
      ["gotify", { server: "https://gotify.example" }],
      ["discord", { url: "not a url" }],
      ["webhook", { url: "file:///etc/passwd" }],
      ["telegram", { botToken: "123:abc" }],
    ] as const) {
      expect((await me.agent.put(`${BASE}/${kind}`).send({ config })).status, `${kind} ${JSON.stringify(config)}`).toBe(400);
    }
    expect((await me.agent.put(`${BASE}/carrier-pigeon`).send({ config: {} })).status).toBe(404);
  });

  it("Send test reports the service's answer, or that it couldn't be reached", async () => {
    const me = await newUser();
    await me.agent.put(`${BASE}/gotify`).send({ config: { server: "https://gotify.example", appToken: "fake-gotify" } });
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      return new Response("nope", { status: 401, statusText: "Unauthorized" });
    }));
    const failed = await me.agent.post(`${BASE}/gotify/test`);
    expect(failed.status).toBe(502);
    expect(failed.body.error).toBe("The service answered 401 Unauthorized");
    expect(calls[0]).toMatchObject({ url: "https://gotify.example/message", headers: { "X-Gotify-Key": "fake-gotify" } });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect((await me.agent.post(`${BASE}/gotify/test`)).body.error).toMatch(/couldn't reach it/);
    expect((await me.agent.post(`${BASE}/slack/test`)).status).toBe(404); // not set up
  });
});

describe("what each service is sent", () => {
  it("ntfy publishes JSON to the server root with the topic; Telegram goes to the bot's sendMessage", async () => {
    const me = await newUser();
    await me.agent.put(`${BASE}/ntfy`).send({ config: { server: "https://ntfy.example/", topic: "beans", token: "fake-token" } });
    await me.agent.put(`${BASE}/telegram`).send({ config: { botToken: "123:ABC", chatId: "42" } });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(null, { status: 200 }))));
    await me.agent.post(`${BASE}/ntfy/test`);
    await me.agent.post(`${BASE}/telegram/test`);
    expect(calls[0]?.url).toBe("https://ntfy.example");
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: "Bearer fake-token" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ topic: "beans", title: "Test from Barista" });
    expect(calls[0]?.init.redirect).toBe("manual");
    expect(calls[1]?.url).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({ chat_id: "42" });
  });
});

describe("rate later (docs/api/brew-logs.md §6)", () => {
  const brew = { actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 };

  it("queues a delayed reminder only with reminders on and an enabled channel", async () => {
    const me = await newUser();
    const ws = await newWorkspace(me);
    const beanId = await newBean(me, ws.id);
    const url = `/api/workspaces/${ws.id}/brew-logs`;

    const none = await me.agent.post(url).send({ beanId, ...brew, remindToRate: true });
    expect(none.status).toBe(201);
    expect(none.body.reminder).toBe("off"); // no channel yet
    expect(none.body.brewLog).not.toHaveProperty("remindToRate");

    await me.agent.put(`${BASE}/ntfy`).send({ config: { topic: "coffee" } });
    await me.agent.patch("/api/auth/me/preferences").send({ rateReminderMinutes: 20 });
    const queued = await me.agent.post(url).send({ beanId, ...brew, remindToRate: true });
    expect(queued.body.reminder).toBe("queued");
    const job = await reminderQueue.getJob(rateReminderJobId(queued.body.brewLog.id));
    expect(job?.data).toEqual({ brewLogId: queued.body.brewLog.id, userId: me.id });
    expect(job?.opts.delay).toBe(20 * 60_000);

    expect((await me.agent.post(url).send({ beanId, ...brew })).body).not.toHaveProperty("reminder"); // not asked
    await me.agent.patch("/api/auth/me/preferences").send({ rateReminders: false });
    expect((await me.agent.post(url).send({ beanId, ...brew, remindToRate: true })).body.reminder).toBe("off");
    // Not a PATCH field.
    expect((await me.agent.patch(`${url}/${queued.body.brewLog.id}`).send({ remindToRate: true })).status).toBe(400);
  });

  it("validates the reminder preferences", async () => {
    const me = await newUser();
    expect((await me.agent.get("/api/auth/me")).body.user.preferences).toMatchObject({ rateReminders: true, rateReminderMinutes: 15 });
    for (const rateReminderMinutes of [4, 241, 10.5]) {
      expect((await me.agent.patch("/api/auth/me/preferences").send({ rateReminderMinutes })).status).toBe(400);
    }
  });
});
