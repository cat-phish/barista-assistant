import { AI_ENV_KEY, AI_SERVER_KEY, aiSource, DEFAULT_SERVER_AI, modelsFor, type AiEnvStatus, type AiProvider, type ServerAiConfig } from "@barista/shared/aiConfig";
import { serverSettings, workspaceAiConfigs } from "@barista/shared/schema";
import { decryptSecret } from "@barista/shared/secrets";
import Anthropic from "@anthropic-ai/sdk";
import { UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { config } from "../config.js";
import { db } from "../db.js";
import type { AiClient, AiModels } from "./client.js";

export const NO_AI = "No AI is set up for this workspace";
const OFFICIAL_URLS: Record<AiProvider, string> = { openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com" };

const envConfigured = (): boolean => Boolean(config.openaiApiKey && config.openaiModel);

function readKey(stored: string): string {
  try {
    return decryptSecret(stored, config.aiConfigSecret ?? "");
  } catch {
    throw new UnrecoverableError("The saved AI key can't be read: AI_CONFIG_SECRET is missing or changed");
  }
}

// baseURL is always passed for a saved key: left out, the SDK reads
// OPENAI_BASE_URL or ANTHROPIC_BASE_URL, and a workspace's key would go to
// the server's address.
function client(provider: AiProvider, apiKey: string, baseURL: string | undefined, models: AiModels): AiClient {
  if (provider === "anthropic") {
    return { provider, apiKey, models, official: baseURL === OFFICIAL_URLS.anthropic, anthropic: new Anthropic({ apiKey, baseURL }) };
  }
  return { provider, apiKey, models, openai: new OpenAI({ apiKey, baseURL }) };
}

async function serverConfig(): Promise<ServerAiConfig> {
  const [row] = await db.select({ value: serverSettings.value }).from(serverSettings).where(eq(serverSettings.key, AI_SERVER_KEY));
  return { ...DEFAULT_SERVER_AI, ...(row?.value as Partial<ServerAiConfig> | undefined) };
}

// Who answers for this workspace, looked up for each job so a change in
// Settings applies at once. No retries when nothing is set up: that won't
// change between attempts.
export async function resolveAi(workspaceId?: string | null): Promise<AiClient> {
  const [own] = workspaceId ? await db.select().from(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId)) : [];
  return clientFor(own, await serverConfig());
}

// The server's own, whether or not it's offered: for trying it in Settings.
export async function resolveServerAi(): Promise<AiClient> {
  return clientFor(undefined, { ...(await serverConfig()), enabled: true });
}

function clientFor(own: typeof workspaceAiConfigs.$inferSelect | undefined, server: ServerAiConfig): AiClient {
  switch (aiSource(Boolean(own), server, envConfigured())) {
    case "workspace":
      return client(own!.provider, readKey(own!.apiKeyEncrypted), OFFICIAL_URLS[own!.provider], modelsFor(own!));
    case "server":
      return client(server.provider, readKey(server.apiKeyEncrypted!), server.baseUrl ?? OFFICIAL_URLS[server.provider], modelsFor({ ...server, model: server.model! }));
    case "env":
      return client("openai", config.openaiApiKey!, undefined, modelsFor({ model: config.openaiModel!, visionModel: config.openaiVisionModel, webModel: config.openaiWebModel }));
    default:
      throw new UnrecoverableError(NO_AI);
  }
}

// Tells the backend whether the env has AI: it isn't given the key.
export async function publishEnvStatus(): Promise<void> {
  const value: AiEnvStatus = { configured: envConfigured(), model: config.openaiModel };
  await db.insert(serverSettings).values({ key: AI_ENV_KEY, value }).onDuplicateKeyUpdate({ set: { value } });
}
