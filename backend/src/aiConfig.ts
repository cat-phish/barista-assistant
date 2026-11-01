// Whether a workspace has AI, and from where (docs/api/workspaces.md §2d).
import { aiSource, type AiSource } from "@barista/shared/aiConfig";
import type { AiCheckJobData } from "@barista/shared/jobs";
import { workspaceAiConfigs } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import type { Response } from "express";
import { db } from "./db.js";
import { sendError } from "./http.js";
import { checkAi, JobTimeoutError, QueueUnavailableError } from "./queue.js";
import { getAiEnvStatus, getServerAi } from "./serverSettings.js";

export interface AiStatus {
  available: boolean;
  source: AiSource | null;
  model: string | null; // the main model in use
}

export async function aiStatus(workspaceId: string): Promise<AiStatus> {
  const [[own], server, env] = await Promise.all([
    db.select({ model: workspaceAiConfigs.model }).from(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId)),
    getServerAi(),
    getAiEnvStatus(),
  ]);
  const source = aiSource(Boolean(own), server, env.configured);
  const model = source === "workspace" ? own!.model : source === "server" ? server.model : source === "env" ? env.model : null;
  return { available: source !== null, source, model };
}

// Settings' model list and Test: the worker's answer, or why it didn't come.
export async function sendAiCheck(res: Response, data: AiCheckJobData): Promise<void> {
  try {
    res.json(await checkAi(data));
  } catch (err) {
    if (err instanceof JobTimeoutError) {
      sendError(res, 504, "The AI didn't answer in time. Try again shortly.");
      return;
    }
    if (err instanceof QueueUnavailableError) {
      sendError(res, 503, "This is temporarily unavailable. Try again shortly.");
      return;
    }
    throw err;
  }
}

// Before queueing an AI job: sends 409 and returns false when nothing would answer it.
export async function requireAi(res: Response, workspaceId: string): Promise<boolean> {
  if ((await aiStatus(workspaceId)).available) return true;
  sendError(res, 409, "No AI is set up for this workspace (Settings → AI)", { code: "ai_not_configured" });
  return false;
}
