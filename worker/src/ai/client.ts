import type OpenAI from "openai";

// What a job calls the AI with, resolved for its workspace (resolve.ts).
export interface AiModels {
  main: string;
  // Reading bean labels from photos (docs/api/llm-contract.md §9c).
  vision: string;
  // Looking a bean up on the web (§9c, step 2).
  web: string;
}
export interface AiClient {
  openai: OpenAI;
  models: AiModels;
}
