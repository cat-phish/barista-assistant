import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationError } from "@barista/shared/notify";
import { endpointHash, PushGoneError, sendWebPush } from "@barista/shared/webPush";
import { anonymous, newBean, newUser, newWorkspace } from "./helpers.js";

// docs/api/notifications.md §1b, "Web Push": the push service itself is faked.
vi.mock("@barista/shared/webPush", async (importOriginal) => {
  const real = await importOriginal<typeof import("@barista/shared/webPush")>();
  return { ...real, sendWebPush: vi.fn() };
});
const send = vi.mocked(sendWebPush);

const BASE = "/api/auth/me/notifications";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const device = (endpoint = ENDPOINT) => ({ endpoint, keys: { p256dh: "test-p256dh-key", auth: "test-auth" }, label: "Android · Chrome" });

function vapidOn() {
  vi.stubEnv("VAPID_PUBLIC_KEY", "BPublicKeyForTests");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key-for-tests");
  vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
}

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Web Push devices", () => {
  it("are off until the server has VAPID keys", async () => {
    const me = await newUser();
    expect((await me.agent.get(`${BASE}/push/key`)).status).toBe(404);
    expect((await me.agent.post(`${BASE}/push`).send(device())).status).toBe(404);
    vapidOn();
    expect((await me.agent.get(`${BASE}/push/key`)).body).toEqual({ publicKey: "BPublicKeyForTests" });
    expect((await anonymous().get(`${BASE}/push/key`)).status).toBe(401);
  });

  it("subscribe, list without the endpoint, switch off, remove; per person", async () => {
    vapidOn();
    const me = await newUser();
    const other = await newUser();
    expect((await me.agent.get(BASE)).body.pushDevices).toEqual([]);

    const saved = await me.agent.post(`${BASE}/push`).send(device());
    expect(saved.status).toBe(200);
    expect(saved.body.device).toMatchObject({ label: "Android · Chrome", enabled: true, endpointHash: endpointHash(ENDPOINT) });
    expect(saved.body.device).not.toHaveProperty("endpoint");
    await me.agent.post(`${BASE}/push`).send({ ...device("https://web.push.apple.com/xyz"), label: "iPhone · Safari" });

    const list = (await me.agent.get(BASE)).body.pushDevices;
    expect(list.map((d: { label: string }) => d.label).sort()).toEqual(["Android · Chrome", "iPhone · Safari"]); // same second: either order
    expect((await other.agent.get(BASE)).body.pushDevices).toEqual([]);

    const id = saved.body.device.id;
    expect((await other.agent.patch(`${BASE}/push/${id}`).send({ enabled: false })).status).toBe(404);
    expect((await me.agent.patch(`${BASE}/push/${id}`).send({ enabled: false })).body.device.enabled).toBe(false);
    expect((await me.agent.patch(`${BASE}/push/${id}`).send({ label: "x" })).status).toBe(400);

    // The same device subscribing again updates it (and switches it back on).
    const again = await me.agent.post(`${BASE}/push`).send({ ...device(), label: "Pixel · Chrome" });
    expect(again.body.device).toMatchObject({ id, enabled: true, label: "Pixel · Chrome" });
    expect((await me.agent.get(BASE)).body.pushDevices).toHaveLength(2);

    expect((await other.agent.delete(`${BASE}/push/${id}`)).status).toBe(404);
    expect((await me.agent.delete(`${BASE}/push/${id}`)).status).toBe(204);
    expect((await me.agent.delete(`${BASE}/push/${id}`)).status).toBe(404);
  });

  it("a device signed in as someone else moves to them", async () => {
    vapidOn();
    const me = await newUser();
    const other = await newUser();
    await me.agent.post(`${BASE}/push`).send(device());
    await other.agent.post(`${BASE}/push`).send(device());
    expect((await me.agent.get(BASE)).body.pushDevices).toEqual([]);
    expect((await other.agent.get(BASE)).body.pushDevices).toHaveLength(1);
  });

  it("validates the subscription", async () => {
    vapidOn();
    const me = await newUser();
    for (const body of [
      { ...device("http://push.example/insecure") },
      { ...device("not a url") },
      { ...device(), keys: { p256dh: "has spaces", auth: "x" } },
      { ...device(), label: "" },
      { ...device(), extra: true },
    ]) {
      expect((await me.agent.post(`${BASE}/push`).send(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("Send test: delivered, refused, or gone (which removes the device)", async () => {
    vapidOn();
    const me = await newUser();
    const id = (await me.agent.post(`${BASE}/push`).send(device())).body.device.id;

    expect((await me.agent.post(`${BASE}/push/${id}/test`)).status).toBe(204);
    expect(send.mock.calls[0]![0]).toMatchObject({ endpoint: ENDPOINT });
    expect(send.mock.calls[0]![2]).toMatchObject({ title: "Test from Barista-Assistant" });

    send.mockRejectedValueOnce(new NotificationError("answered 403"));
    const refused = await me.agent.post(`${BASE}/push/${id}/test`);
    expect(refused.status).toBe(502);
    expect(refused.body.error).toBe("The push service answered 403");

    send.mockRejectedValueOnce(new PushGoneError("says the device is no longer subscribed"));
    expect((await me.agent.post(`${BASE}/push/${id}/test`)).status).toBe(410);
    expect((await me.agent.get(BASE)).body.pushDevices).toEqual([]);
  });

  it("an enabled device lets reminders be queued, while Web Push is set up", async () => {
    vapidOn();
    const me = await newUser();
    const ws = await newWorkspace(me);
    const beanId = await newBean(me, ws.id);
    const brew = { beanId, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, remindToRate: true };
    const url = `/api/workspaces/${ws.id}/brew-logs`;

    expect((await me.agent.post(url).send(brew)).body.reminder).toBe("off");
    const id = (await me.agent.post(`${BASE}/push`).send(device())).body.device.id;
    expect((await me.agent.post(url).send(brew)).body.reminder).toBe("queued");
    await me.agent.patch(`${BASE}/push/${id}`).send({ enabled: false });
    expect((await me.agent.post(url).send(brew)).body.reminder).toBe("off");
    await me.agent.patch(`${BASE}/push/${id}`).send({ enabled: true });
    vi.unstubAllEnvs(); // the server's keys taken away
    expect((await me.agent.post(url).send(brew)).body.reminder).toBe("off");
  });
});
