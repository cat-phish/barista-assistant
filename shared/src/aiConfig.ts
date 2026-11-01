// Who answers a workspace's AI jobs (docs/api/workspaces.md §2d). Used by the
// backend, to say whether AI is available, and the worker, to call it.
export const AI_PROVIDERS = ["openai", "anthropic"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AiSource = "workspace" | "server" | "env";

// The server's AI, in server_settings. enabled: offered to workspaces without
// their own key, this config or else the worker's env. The base URL is the
// server's alone: it decides where the worker sends requests.
export interface ServerAiConfig {
  enabled: boolean;
  provider: AiProvider;
  apiKeyEncrypted: string | null;
  apiKeyLast4: string | null;
  baseUrl: string | null;
  model: string | null;
  visionModel: string | null;
  webModel: string | null;
}
export const AI_SERVER_KEY = "ai";
export const DEFAULT_SERVER_AI: ServerAiConfig = { enabled: true, provider: "openai", apiKeyEncrypted: null, apiKeyLast4: null, baseUrl: null, model: null, visionModel: null, webModel: null };

// The worker's env, as it tells the backend when it starts (never the key:
// the backend doesn't have it). No row yet: assume it's set, as it had to be.
export interface AiEnvStatus {
  configured: boolean;
  model: string | null;
}
export const AI_ENV_KEY = "ai_env";
export const DEFAULT_AI_ENV: AiEnvStatus = { configured: true, model: null };

export function aiSource(hasOwnKey: boolean, server: ServerAiConfig, envConfigured: boolean): AiSource | null {
  if (hasOwnKey) return "workspace";
  if (!server.enabled) return null;
  if (server.apiKeyEncrypted && server.model) return "server";
  return envConfigured ? "env" : null;
}

// A blank vision model uses the main one, a blank web model the vision one.
export function modelsFor(c: { model: string; visionModel: string | null; webModel: string | null }): { main: string; vision: string; web: string } {
  const vision = c.visionModel || c.model;
  return { main: c.model, vision, web: c.webModel || vision };
}

export const lastFour = (key: string): string => key.slice(-4);
