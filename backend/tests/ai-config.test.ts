import { AI_ENV_KEY, AI_SERVER_KEY, DEFAULT_SERVER_AI } from "@barista/shared/aiConfig";
import { analysisRequests, serverSettings, workspaceAiConfigs } from "@barista/shared/schema";
import { decryptSecret, encryptSecret } from "@barista/shared/secrets";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { setAdmin } from "../src/adminAccess.js";
import { db } from "../src/db.js";
import { addMember, newBean, newBrewLog, newUser, newWorkspace, type TestUser } from "./helpers.js";

const KEY = "sk-test-workspace-key-a1b2";
const SECRET = process.env.AI_CONFIG_SECRET!;
const save = { provider: "openai", model: "gpt-own" };

let owner: TestUser;
let ws: string;
const url = () => `/api/workspaces/${ws}/ai-config`;

const envIs = (configured: boolean) => db.insert(serverSettings).values({ key: AI_ENV_KEY, value: { configured, model: "gpt-env" } });

beforeEach(async () => {
  owner = await newUser();
  ws = (await newWorkspace(owner)).id;
});

describe("secrets", () => {
  it("round-trips, and refuses a changed value or another secret", () => {
    const stored = encryptSecret(KEY, SECRET);
    expect(stored).not.toContain(KEY);
    expect(decryptSecret(stored, SECRET)).toBe(KEY);
    const [iv, tag, data] = stored.split(".");
    const flipped = Buffer.from(data!, "base64");
    flipped[0]! ^= 1;
    expect(() => decryptSecret([iv, tag, flipped.toString("base64")].join("."), SECRET)).toThrow();
    expect(() => decryptSecret(stored, "x".repeat(40))).toThrow();
  });
});

describe("a workspace's AI (docs/api/workspaces.md §2d)", () => {
  it("saves the key encrypted and never sends it back", async () => {
    const res = await owner.agent.put(url()).send({ ...save, apiKey: KEY });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(res.body).toMatchObject({ available: true, source: "workspace", model: "gpt-own", own: { provider: "openai", keyLast4: "a1b2", model: "gpt-own", visionModel: null } });
    const [row] = await db.select().from(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, ws));
    expect(row!.apiKeyEncrypted).not.toContain(KEY);
    expect(decryptSecret(row!.apiKeyEncrypted, SECRET)).toBe(KEY);
  });

  it("keeps the saved key when only the models change, and needs one to start", async () => {
    expect((await owner.agent.put(url()).send(save)).status).toBe(400);
    await owner.agent.put(url()).send({ ...save, apiKey: KEY });
    const res = await owner.agent.put(url()).send({ ...save, model: "gpt-new", visionModel: "gpt-eyes" });
    expect(res.body.own).toMatchObject({ keyLast4: "a1b2", model: "gpt-new", visionModel: "gpt-eyes" });
  });

  it("refuses a base URL: that's the server's alone", async () => {
    expect((await owner.agent.put(url()).send({ ...save, apiKey: KEY, baseUrl: "http://10.0.0.1" })).status).toBe(400);
  });

  it("lets only owners change it, and only they see the key's end", async () => {
    await owner.agent.put(url()).send({ ...save, apiKey: KEY });
    for (const role of ["barista", "viewer"]) {
      const member = await newUser();
      await addMember(owner, ws, member, role);
      const seen = await member.agent.get(url());
      expect(seen.body).toMatchObject({ available: true, source: "workspace", model: "gpt-own", own: null });
      expect((await member.agent.put(url()).send(save)).status).toBe(403);
      expect((await member.agent.delete(url())).status).toBe(403);
    }
    expect((await (await newUser()).agent.get(url())).status).toBe(404);
  });

  it("falls back to the server's when removed", async () => {
    await owner.agent.put(url()).send({ ...save, apiKey: KEY });
    const res = await owner.agent.delete(url());
    expect(res.body).toMatchObject({ source: "env", own: null });
  });
});

describe("the server's AI (docs/api/server.md §10b)", () => {
  let admin: TestUser;
  beforeEach(async () => {
    admin = await newUser();
    await setAdmin(admin.email, true);
  });

  it("is for admins, and the key is write-only", async () => {
    expect((await owner.agent.get("/api/server/ai")).status).toBe(403);
    const res = await admin.agent.put("/api/server/ai").send({ enabled: true, provider: "openai", apiKey: KEY, baseUrl: "http://10.0.0.5:11434/v1", model: "llama" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(res.body).not.toHaveProperty("apiKeyEncrypted");
    expect(res.body).toMatchObject({ keyLast4: "a1b2", baseUrl: "http://10.0.0.5:11434/v1", model: "llama" });
    expect((await owner.agent.get(url())).body).toMatchObject({ available: true, source: "server", model: "llama" });
  });

  it("needs a model with a key, and removing it keeps the switch", async () => {
    expect((await admin.agent.put("/api/server/ai").send({ enabled: true, provider: "openai", apiKey: KEY })).status).toBe(400);
    await admin.agent.put("/api/server/ai").send({ enabled: false, provider: "openai", apiKey: KEY, model: "m" });
    const res = await admin.agent.delete("/api/server/ai");
    expect(res.body).toMatchObject({ enabled: false, keyLast4: null, model: null });
  });

  it("turned off, only workspaces with their own key have AI", async () => {
    await admin.agent.put("/api/server/ai").send({ enabled: false, provider: "openai" });
    expect((await owner.agent.get(url())).body).toMatchObject({ available: false, source: null });
    expect((await owner.agent.put(url()).send({ ...save, apiKey: KEY })).body).toMatchObject({ available: true, source: "workspace" });
  });
});

describe("with no AI set up", () => {
  beforeEach(async () => {
    await db.insert(serverSettings).values({ key: AI_SERVER_KEY, value: { ...DEFAULT_SERVER_AI, enabled: false } });
  });

  it("refuses to queue AI jobs", async () => {
    const bean = await newBean(owner, ws);
    const brew = await newBrewLog(owner, ws, bean, { rating: 4 });
    const none = { code: "ai_not_configured" };
    const analyze = await owner.agent.post(`/api/brew-logs/${brew}/analyze`).send({});
    expect([analyze.status, analyze.body]).toEqual([409, expect.objectContaining(none)]);
    const suggest = await owner.agent.post(`/api/workspaces/${ws}/parameter-suggestions`).send({ beanId: bean, source: "bean" });
    expect([suggest.status, suggest.body]).toEqual([409, expect.objectContaining(none)]);
    const review = await owner.agent.post(`/api/workspaces/${ws}/beans/${bean}/review-draft`).send({});
    expect([review.status, review.body]).toEqual([409, expect.objectContaining(none)]);
    await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ labelWebLookup: true });
    const web = await owner.agent.post(`/api/workspaces/${ws}/bean-label/web`).send({ fields: { roasterName: "Onyx" } });
    expect([web.status, web.body]).toEqual([409, expect.objectContaining(none)]);
  });
});

describe("with no AI set up, automatically", () => {
  it("doesn't queue an analysis for a rated brew", async () => {
    await db.insert(serverSettings).values({ key: AI_SERVER_KEY, value: { ...DEFAULT_SERVER_AI, enabled: false } });
    await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ autoAnalyze: true });
    const brew = await newBrewLog(owner, ws, await newBean(owner, ws), { rating: 4 });
    expect(await db.select().from(analysisRequests).where(eq(analysisRequests.brewLogId, brew))).toEqual([]);
  });
});

describe("the worker's env status", () => {
  it("counts when the worker says it has no key", async () => {
    await envIs(false);
    expect((await owner.agent.get(url())).body).toMatchObject({ available: false, source: null, model: null });
  });
});
