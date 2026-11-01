import { connectionSettings, secretIfSet } from "@barista/shared/env";
import { parseTimeZone } from "./localDate.js";

// Secrets accept NAME or NAME_FILE (Docker secrets); see shared/src/env.ts.
// OPENAI_BASE_URL (optional) is read by the OpenAI SDK itself.
const openaiModel = process.env.OPENAI_MODEL?.trim() || null;
const openaiVisionModel = process.env.OPENAI_VISION_MODEL?.trim() || openaiModel;

export const config = {
  database: connectionSettings("DATABASE_URL", "DATABASE_PASSWORD"),
  redis: connectionSettings("REDIS_URL", "REDIS_PASSWORD"),
  // The AI is optional: without these, AI jobs fail and the rest still runs.
  openaiApiKey: secretIfSet("OPENAI_API_KEY") ?? null,
  // No default: valid model names change over time.
  openaiModel,
  // Reading bean labels from photos (docs/api/llm-contract.md §9c) needs a
  // model that takes images; unset = OPENAI_MODEL.
  openaiVisionModel,
  // Looking a bean up on the web (§9c, step 2) needs a model with the web
  // search tool on the Responses API; unset = the vision model.
  openaiWebModel: process.env.OPENAI_WEB_MODEL?.trim() || openaiVisionModel,
  // Decrypts AI keys saved in Settings.
  aiConfigSecret: secretIfSet("AI_CONFIG_SECRET") ?? null,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  // Zone for brews logged without a UTC offset (older ones); null = UTC.
  brewTimezone: parseTimeZone(process.env.BREW_TIMEZONE),
  // Where the app is opened, for links in reminders (no trailing slash);
  // unset = reminders without a link.
  appUrl: process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, "") : null,
} as const;
