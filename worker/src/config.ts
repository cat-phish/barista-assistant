import { connectionSettings, requireEnv, requireSecret } from "@barista/shared/env";
import { parseTimeZone } from "./localDate.js";

// Secrets accept NAME or NAME_FILE (Docker secrets); see shared/src/env.ts.
// OPENAI_BASE_URL (optional) is read by the OpenAI SDK itself.
export const config = {
  database: connectionSettings("DATABASE_URL", "DATABASE_PASSWORD"),
  redis: connectionSettings("REDIS_URL", "REDIS_PASSWORD"),
  openaiApiKey: requireSecret("OPENAI_API_KEY"),
  // No default: valid model names change over time.
  openaiModel: requireEnv("OPENAI_MODEL"),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  // Zone for brews logged without a UTC offset (older ones); null = UTC.
  brewTimezone: parseTimeZone(process.env.BREW_TIMEZONE),
} as const;
