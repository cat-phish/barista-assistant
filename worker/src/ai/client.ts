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
export interface AiClient {
  apiKey: string; // to keep it out of what's logged (withoutKey)
  openai: OpenAI;
  models: AiModels;
}
