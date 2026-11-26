import { AI_ENV_KEY, AI_SERVER_KEY, DEFAULT_SERVER_AI } from "@barista/shared/aiConfig";
import { serverSettings, workspaceAiConfigs, workspaces } from "@barista/shared/schema";
import { encryptSecret } from "@barista/shared/secrets";
import { UnrecoverableError } from "bullmq";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withoutKey } from "../src/ai/client.js";
import { NO_AI, publishEnvStatus, resolveAi } from "../src/ai/resolve.js";
import { db } from "../src/db.js";

const SECRET = process.env.AI_CONFIG_SECRET!;

async function workspaceWithKey(key: string, models: { visionModel?: string } = {}): Promise<string> {
  const id = randomUUID();
  await db.insert(workspaces).values({ id, name: "W", slug: `w-${id.slice(0, 8)}` });
  await db.insert(workspaceAiConfigs).values({ workspaceId: id, provider: "openai", apiKeyEncrypted: encryptSecret(key, SECRET), apiKeyLast4: "1234", model: "own", ...models });
  return id;
}
const serverAi = (value: Partial<typeof DEFAULT_SERVER_AI>) => db.insert(serverSettings).values({ key: AI_SERVER_KEY, value: { ...DEFAULT_SERVER_AI, ...value } });

describe("resolveAi (docs/api/workspaces.md §2d)", () => {
  it("uses the env when nothing is saved", async () => {
    const ai = await resolveAi("no-such-workspace");
    expect(ai.apiKey).toBe(process.env.OPENAI_API_KEY);
    expect(ai.models).toEqual({ main: "test-model", vision: "test-model", web: "test-model" });
  });

  it("prefers the server's saved AI, at its address", async () => {
    await serverAi({ apiKeyEncrypted: encryptSecret("server-key", SECRET), baseUrl: "http://10.0.0.5:11434/v1", model: "local" });
    const ai = await resolveAi();
    expect([ai.apiKey, ai.models.main, ai.provider === "openai" && ai.openai.baseURL]).toEqual(["server-key", "local", "http://10.0.0.5:11434/v1"]);
  });

  it("prefers the workspace's own, and never sends its key to a server address", async () => {
    await serverAi({ apiKeyEncrypted: encryptSecret("server-key", SECRET), baseUrl: "http://10.0.0.5:11434/v1", model: "local" });
    const ai = await resolveAi(await workspaceWithKey("own-key", { visionModel: "eyes" }));
    expect([ai.apiKey, ai.provider === "openai" && ai.openai.baseURL]).toEqual(["own-key", "https://api.openai.com/v1"]); // OPENAI_BASE_URL is set in tests
    expect(ai.models).toEqual({ main: "own", vision: "eyes", web: "eyes" });
  });

  it("uses Claude's own client and address for an Anthropic key", async () => {
    const id = await workspaceWithKey("ant-key");
    await db.update(workspaceAiConfigs).set({ provider: "anthropic" }).where(eq(workspaceAiConfigs.workspaceId, id));
    process.env.ANTHROPIC_BASE_URL = "http://10.0.0.5:9"; // never for a workspace's key
    const ai = await resolveAi(id);
    delete process.env.ANTHROPIC_BASE_URL;
    expect(ai.provider).toBe("anthropic");
    expect(ai.provider === "anthropic" && [ai.official, ai.anthropic.baseURL]).toEqual([true, "https://api.anthropic.com"]);
  });

  it("switched off, stops the server's and the env's AI but not a workspace's own", async () => {
    await serverAi({ enabled: false });
    const failure = await resolveAi("no-such-workspace").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnrecoverableError);
    expect((failure as Error).message).toBe(NO_AI);
    expect((await resolveAi(await workspaceWithKey("own-key"))).apiKey).toBe("own-key");
  });

  it("says so when a saved key can't be read, without retries", async () => {
    const id = await workspaceWithKey("own-key");
    await db.update(workspaceAiConfigs).set({ apiKeyEncrypted: encryptSecret("own-key", "y".repeat(40)) }).where(eq(workspaceAiConfigs.workspaceId, id));
    await expect(resolveAi(id)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  describe("per feature (§2d)", () => {
    const enc = (k: string) => encryptSecret(k, SECRET);
    const withOverrides = async (overrides: object) => {
      const id = await workspaceWithKey("own-key", { visionModel: "eyes" });
      await db.update(workspaceAiConfigs).set({ overrides }).where(eq(workspaceAiConfigs.workspaceId, id));
      return id;
    };

    it("uses the main for a feature without one, and for jobs with no feature", async () => {
      const id = await withOverrides({ suggest: { provider: "openai", apiKeyEncrypted: null, apiKeyLast4: null, model: "thinker" } });
      expect((await resolveAi(id, "analysis")).models).toEqual({ main: "own", vision: "eyes", web: "eyes" });
      expect((await resolveAi(id)).models.main).toBe("own");
    });

    it("same provider, no key: the main key with the feature's model, images too", async () => {
      const id = await withOverrides({ chat: { provider: "openai", apiKeyEncrypted: null, apiKeyLast4: null, model: "talker" } });
      const ai = await resolveAi(id, "chat");
      expect([ai.apiKey, ai.models]).toEqual(["own-key", { main: "talker", vision: "talker", web: "talker" }]);
    });

    it("own key: that key, and another provider at its own address", async () => {
      const id = await withOverrides({
        suggest: { provider: "openai", apiKeyEncrypted: enc("sugg-key"), apiKeyLast4: "-key", model: null },
        writing: { provider: "anthropic", apiKeyEncrypted: enc("ant-key"), apiKeyLast4: "-key", model: "claude-x" },
      });
      const sugg = await resolveAi(id, "suggest");
      expect([sugg.apiKey, sugg.models.main]).toEqual(["sugg-key", "own"]);
      const writing = await resolveAi(id, "writing");
      expect([writing.provider, writing.apiKey, writing.models.main]).toEqual(["anthropic", "ant-key", "claude-x"]);
      expect(writing.provider === "anthropic" && writing.anthropic.baseURL).toBe("https://api.anthropic.com");
    });

    it("ignores another provider without its own key", async () => {
      const id = await withOverrides({ web: { provider: "anthropic", apiKeyEncrypted: null, apiKeyLast4: null, model: "claude-x" } });
      const ai = await resolveAi(id, "web");
      expect([ai.provider, ai.apiKey, ai.models.web]).toEqual(["openai", "own-key", "eyes"]);
    });

    it("server: its address for its provider only", async () => {
      await serverAi({
        apiKeyEncrypted: encryptSecret("server-key", SECRET),
        baseUrl: "http://10.0.0.5:11434/v1",
        model: "local",
        overrides: {
          chat: { provider: "openai", apiKeyEncrypted: null, apiKeyLast4: null, model: "local-chat" },
          suggest: { provider: "anthropic", apiKeyEncrypted: encryptSecret("ant-key", SECRET), apiKeyLast4: "-key", model: "claude-x" },
        },
      });
      const chat = await resolveAi(null, "chat");
      expect([chat.apiKey, chat.models.main, chat.provider === "openai" && chat.openai.baseURL]).toEqual(["server-key", "local-chat", "http://10.0.0.5:11434/v1"]);
      const sugg = await resolveAi(null, "suggest");
      expect([sugg.provider, sugg.apiKey, sugg.provider === "anthropic" && sugg.anthropic.baseURL]).toEqual(["anthropic", "ant-key", "https://api.anthropic.com"]);
    });
  });

  it("publishes whether the env has AI, never the key", async () => {
    await publishEnvStatus();
    const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, AI_ENV_KEY));
    expect(row!.value).toEqual({ configured: true, model: "test-model" });
  });

  it("scrubs the key from error text", () => {
    expect(withoutKey("Incorrect API key provided: sk-abc. Try again", "sk-abc")).toBe("Incorrect API key provided: [key]. Try again");
  });
});
