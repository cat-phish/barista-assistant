// Security audit session 4, Low findings: SEC-05, SEC-36, SEC-39, SEC-51, SEC-52, SEC-62.
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { decryptSecret, encryptSecret } from "@barista/shared/secrets";
import { checkBackup } from "../src/backup.js";
import { newBean, newUser, newWorkspace } from "./helpers.js";

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
  it("SEC-05 doesn't move another person's endpoint to the caller", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "BPublicKeyForTests");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private-key-for-tests");
    vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
    const a = await newUser();
    const b = await newUser();
    const endpoint = "https://fcm.googleapis.com/fcm/send/sec05";
    expect((await a.agent.post(`${NOTIFY}/push`).send(device(endpoint))).status).toBe(200);
    expect((await b.agent.post(`${NOTIFY}/push`).send(device(endpoint))).status).toBe(409);
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
