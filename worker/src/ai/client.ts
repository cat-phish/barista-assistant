import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";

// What a job calls the AI with, resolved for its workspace (resolve.ts).
// A provider's error text can quote the key: it's logged and may be shown.
export function withoutKey(text: string, apiKey: string): string {
  return text.replaceAll(apiKey, "[key]");
}

export interface AiModels {
  main: string;
  // Reading bean labels from photos (docs/api/llm-contract.md §9c).
  vision: string;
  // Looking a bean up on the web (§9c, step 2).
  web: string;
}
interface AiBase {
  apiKey: string; // to keep it out of what's logged (withoutKey)
  models: AiModels;
}
export interface OpenAiAi extends AiBase {
  provider: "openai";
  openai: OpenAI;
}
export interface AnthropicAi extends AiBase {
  provider: "anthropic";
  anthropic: Anthropic;
  official: boolean; // Anthropic's own API, not one at a base URL
}
export type AiClient = OpenAiAi | AnthropicAi;
