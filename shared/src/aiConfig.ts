// Who answers a workspace's AI jobs (docs/api/workspaces.md §2d). Used by the
// backend, to say whether AI is available, and the worker, to call it.
export const AI_PROVIDERS = ["openai", "anthropic"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AiSource = "workspace" | "server" | "env";

// Features that can have their own model, and their own key and provider
// (docs/api/workspaces.md §2d, "Per feature"). Jobs not listed use the main.
export const AI_FEATURES = ["analysis", "suggest", "chat", "writing", "label", "web"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
// provider other than the default's: own key and model required.
// Same provider: no key uses the default's, no model the default's model.
export interface AiOverride {
  provider: AiProvider;
  apiKeyEncrypted: string | null;
  apiKeyLast4: string | null;
  model: string | null;
}
export type AiOverrides = Partial<Record<AiFeature, AiOverride>>;
// What settings show of one: never the key.
export interface AiOverrideView {
  provider: AiProvider;
  keyLast4: string | null;
  model: string | null;
}
export type AiOverridesView = Partial<Record<AiFeature, AiOverrideView>>;
export function overridesView(overrides: AiOverrides | null | undefined): AiOverridesView {
  const out: AiOverridesView = {};
  for (const f of AI_FEATURES) {
    const o = overrides?.[f];
    if (o) out[f] = { provider: o.provider, keyLast4: o.apiKeyLast4, model: o.model };
  }
  return out;
}

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
  overrides?: AiOverrides;
}
export const AI_SERVER_KEY = "ai";
export const DEFAULT_SERVER_AI: ServerAiConfig = { enabled: true, provider: "openai", apiKeyEncrypted: null, apiKeyLast4: null, baseUrl: null, model: null, visionModel: null, webModel: null, overrides: {} };

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

// Who answers one feature: the default (provider, key, models), or the
// feature's override. An override that doesn't stand on its own (another
// provider without its own key and model) is ignored. key is whatever the
// caller holds (encrypted for saved configs).
export interface FeatureAi<K> {
  provider: AiProvider;
  key: K;
  ownKey: boolean; // the override's key, not the default's
  models: { main: string; vision: string; web: string };
}
export function resolveFeature<K>(
  base: { provider: AiProvider; key: K; model: string; visionModel: string | null; webModel: string | null },
  override: { provider: AiProvider; key: K | null; model: string | null } | undefined,
): FeatureAi<K> {
  const models = modelsFor(base);
  if (!override || !usableOverride(override, base.provider)) return { provider: base.provider, key: base.key, ownKey: false, models };
  // One model for the feature, images included (chat with photos).
  const m = override.model;
  return {
    provider: override.provider,
    key: override.key ?? base.key,
    ownKey: override.key !== null,
    models: m ? { main: m, vision: m, web: m } : models,
  };
}
export function usableOverride(o: { provider: AiProvider; key?: unknown; apiKeyEncrypted?: unknown; model: string | null }, defaultProvider: AiProvider): boolean {
  if (o.provider === defaultProvider) return true;
  const key = "key" in o ? o.key : o.apiKeyEncrypted;
  return key != null && !!o.model;
}

export const lastFour = (key: string): string => key.slice(-4);

// Limits on AI chats (docs/api/chat.md §12). null: no limit.
export interface ChatLimits {
  maxBytes: number | null; // what a person's chats take on disk
  maxDays: number | null; // since a chat's last message
}
export interface ServerChatLimits extends ChatLimits {
  dailyMessages: number | null; // what one person can send in 24 hours
  maxPinned: number | null; // pinned chats one person can have, all workspaces
  // When maxDays was last made stricter (ISO), set by the server: pinned chats
  // it catches are kept PIN_GRACE_DAYS more from then (docs/api/chat.md §12).
  maxDaysSetAt: string | null;
}
// A person's own, which can also lower how many brews a live Period sends in
// detail (chatPeriodMaxBrews; absent or null: the workspace's).
export interface OwnChatLimits extends ChatLimits {
  periodMaxBrews?: number | null;
}
export const CHAT_LIMITS_KEY = "chat_limits";
export const DEFAULT_SERVER_CHAT_LIMITS: ServerChatLimits = { maxBytes: 1024 ** 3, maxDays: null, dailyMessages: 200, maxPinned: 20, maxDaysSetAt: null };
export const PIN_GRACE_DAYS = 7;
// A save that makes maxDays stricter (new, or lower) starts the grace again.
export function nextMaxDaysSetAt(before: Pick<ServerChatLimits, "maxDays" | "maxDaysSetAt">, maxDays: number | null, now: Date): string | null {
  const stricter = maxDays !== null && (before.maxDays === null || maxDays < before.maxDays);
  return stricter ? now.toISOString() : before.maxDaysSetAt;
}
// When a pinned chat goes under the server's age limit: maxDays after its
// last message, but never within the grace after the limit was set.
export function pinnedExpiry(updatedAt: Date, server: Pick<ServerChatLimits, "maxDays" | "maxDaysSetAt">): Date | null {
  if (server.maxDays === null) return null;
  const byAge = updatedAt.getTime() + server.maxDays * 86_400_000;
  const grace = server.maxDaysSetAt ? Date.parse(server.maxDaysSetAt) + PIN_GRACE_DAYS * 86_400_000 : 0;
  return new Date(Math.max(byAge, grace));
}
export const CHAT_PINNED_MAX = 1000; // the most an admin can allow
export const NO_CHAT_LIMITS: ChatLimits = { maxBytes: null, maxDays: null };

const stricter = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.min(a, b));
// Both apply, so a person can't go past the server's.
export function effectiveChatLimits(server: ChatLimits, own: ChatLimits | null): ChatLimits {
  return { maxBytes: stricter(server.maxBytes, own?.maxBytes ?? null), maxDays: stricter(server.maxDays, own?.maxDays ?? null) };
}
