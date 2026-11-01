import { UnrecoverableError } from "bullmq";
import OpenAI from "openai";
import { config } from "../config.js";
import type { AiClient } from "./client.js";

export const NO_AI = "No AI is set up for this workspace";

let fromEnv: AiClient | null = null;

// Who answers for this workspace, looked up for each job. No retries when
// nothing is set up: that won't change between attempts.
export async function resolveAi(_workspaceId?: string | null): Promise<AiClient> {
  if (!config.openaiApiKey || !config.openaiModel) throw new UnrecoverableError(NO_AI);
  fromEnv ??= {
    openai: new OpenAI({ apiKey: config.openaiApiKey }),
    models: { main: config.openaiModel, vision: config.openaiVisionModel ?? config.openaiModel, web: config.openaiWebModel ?? config.openaiModel },
  };
  return fromEnv;
}
