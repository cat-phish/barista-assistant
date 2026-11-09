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

// Limits on AI chats (docs/api/chat.md §12). null: no limit.
export interface ChatLimits {
  maxBytes: number | null; // what a person's chats take on disk
  maxDays: number | null; // since a chat's last message
}
export interface ServerChatLimits extends ChatLimits {
  dailyMessages: number | null; // what one person can send in 24 hours
}
// A person's own, which can also lower how many brews a live Period sends in
// detail (chatPeriodMaxBrews; absent or null: the workspace's).
export interface OwnChatLimits extends ChatLimits {
  periodMaxBrews?: number | null;
}
export const CHAT_LIMITS_KEY = "chat_limits";
export const DEFAULT_SERVER_CHAT_LIMITS: ServerChatLimits = { maxBytes: 1024 ** 3, maxDays: null, dailyMessages: 200 };
export const NO_CHAT_LIMITS: ChatLimits = { maxBytes: null, maxDays: null };

const stricter = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));
// Both apply, so a person can't go past the server's.
export function effectiveChatLimits(server: ChatLimits, own: ChatLimits | null): ChatLimits {
  return { maxBytes: stricter(server.maxBytes, own?.maxBytes ?? null), maxDays: stricter(server.maxDays, own?.maxDays ?? null) };
}
