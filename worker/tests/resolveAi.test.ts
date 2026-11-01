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
    expect([ai.apiKey, ai.models.main, ai.openai.baseURL]).toEqual(["server-key", "local", "http://10.0.0.5:11434/v1"]);
  });

  it("prefers the workspace's own, and never sends its key to a server address", async () => {
    await serverAi({ apiKeyEncrypted: encryptSecret("server-key", SECRET), baseUrl: "http://10.0.0.5:11434/v1", model: "local" });
    const ai = await resolveAi(await workspaceWithKey("own-key", { visionModel: "eyes" }));
    expect([ai.apiKey, ai.openai.baseURL]).toEqual(["own-key", "https://api.openai.com/v1"]); // OPENAI_BASE_URL is set in tests
    expect(ai.models).toEqual({ main: "own", vision: "eyes", web: "eyes" });
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

  it("publishes whether the env has AI, never the key", async () => {
    await publishEnvStatus();
    const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, AI_ENV_KEY));
    expect(row!.value).toEqual({ configured: true, model: "test-model" });
  });

  it("scrubs the key from error text", () => {
    expect(withoutKey("Incorrect API key provided: sk-abc. Try again", "sk-abc")).toBe("Incorrect API key provided: [key]. Try again");
  });
});
