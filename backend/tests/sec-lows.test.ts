// Security audit session 4, Low findings: SEC-05, SEC-36, SEC-39, SEC-51, SEC-52, SEC-62.
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { decryptSecret, encryptSecret } from "@barista/shared/secrets";
import { checkBackup } from "../src/backup.js";
import { newBean, newUser, newWorkspace } from "./helpers.js";

vi.hoisted(() => {
  process.env.TEST_SEND_LIMIT_PER_HOUR = "10";
});
vi.mock("@barista/shared/webPush", async (importOriginal) => {
  const real = await importOriginal<typeof import("@barista/shared/webPush")>();
  return { ...real, sendWebPush: vi.fn().mockResolvedValue(undefined) };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const NOTIFY = "/api/auth/me/notifications";
const device = (endpoint: string) => ({ endpoint, keys: { p256dh: "test-p256dh-key", auth: "test-auth" }, label: "Android" });

describe("SEC-36 password hashing and policy", () => {
  it("records its cost in the stored hash", async () => {
    expect(await hashPassword("x-correct-horse")).toMatch(/^scrypt\$\d+\$/);
  });
  it("refuses a common password", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "weak-pw@example.com", password: "password1" });
    expect(res.status).toBe(400);
  });
});

describe("SEC-39 secrets", () => {
  const secret = "s".repeat(40);
  it("rejects a truncated GCM tag", () => {
    const [iv, tag, data] = encryptSecret("k", secret).split(".");
    const short = Buffer.from(tag!, "base64").subarray(0, 4).toString("base64");
    expect(() => decryptSecret([iv, short, data].join("."), secret)).toThrow();
  });
});

describe("SEC-51 test sends are unthrottled", () => {
  it("answers 429 on the 11th webhook test in a row", async () => {
    const me = await newUser();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    await me.agent.put(`${NOTIFY}/webhook`).send({ config: { url: "https://hooks.example.com/x" } });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await me.agent.post(`${NOTIFY}/webhook/test`)).status);
    expect(statuses[10]).toBe(429);
  });
});

describe("SEC-52 / SEC-05 web push endpoints", () => {
  it("refuses loopback and metadata hosts", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "BPublicKeyForTests");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key-for-tests");
    vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
    const me = await newUser();
    for (const endpoint of ["https://127.0.0.1:3000/x", "https://[::1]/", "https://host.docker.internal/", "https://169.254.169.254/"]) {
      expect((await me.agent.post(`${NOTIFY}/push`).send(device(endpoint))).status, endpoint).toBe(400);
    }
  });
  // Owner decision: takeover is refused; the first owner removes the device.
  it("SEC-05 doesn't move another person's endpoint to the caller", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "BPublicKeyForTests");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key-for-tests");
    vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
    const a = await newUser();
    const b = await newUser();
    const endpoint = `https://push.example.com/${crypto.randomUUID()}`;
    const first = await a.agent.post(`${NOTIFY}/push`).send(device(endpoint));
    expect(first.status).toBe(200);
    expect((await a.agent.post(`${NOTIFY}/push`).send(device(endpoint))).status).toBe(200); // same person again
    expect((await b.agent.post(`${NOTIFY}/push`).send(device(endpoint))).status).toBe(409);
    await a.agent.delete(`${NOTIFY}/push/${first.body.device.id}`);
    expect((await b.agent.post(`${NOTIFY}/push`).send(device(endpoint))).status).toBe(200);
  });
});

describe("SEC-62 bean website scheme", () => {
  it("checkBackup refuses a javascript: website", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    await newBean(owner, ws.id, { website: "https://example.com" });
    const backup = (await owner.agent.get(`/api/workspaces/${ws.id}/backup`)).body;
    backup.tables.beans[0].website = "javascript:alert(1)";
    const checked = checkBackup(backup);
    expect(checked.ok).toBe(false);
  });
});

describe("SEC-50 ALLOW_PRIVATE_WEBHOOKS", () => {
  const save = (me: Awaited<ReturnType<typeof newUser>>, url: string) => me.agent.put(`${NOTIFY}/webhook`).send({ enabled: true, config: { url } });
  it("says how to allow a private address when the flag is off", async () => {
    const me = await newUser();
    const res = await save(me, "http://192.168.1.20:8080/hook");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("ALLOW_PRIVATE_WEBHOOKS=true");
  });
  it("allows a private address when on, but never loopback, metadata or this stack's services", async () => {
    vi.stubEnv("ALLOW_PRIVATE_WEBHOOKS", "true");
    const me = await newUser();
    expect((await save(me, "http://192.168.1.20:8080/hook")).status).toBe(200);
    expect((await save(me, "http://host.docker.internal:8080/hook")).status).toBe(200);
    for (const url of ["http://127.0.0.1/", "http://169.254.169.254/", "http://[::ffff:7f00:1]/", "http://redis:6379/"]) {
      expect((await save(me, url)).status, url).toBe(400);
    }
  });
});
