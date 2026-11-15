// Whether a workspace has AI, and from where (docs/api/workspaces.md §2d).
import { aiSource, type AiSource } from "@barista/shared/aiConfig";
import type { AiCheckJobData } from "@barista/shared/jobs";
import { workspaceAiConfigs } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import type { Response } from "express";
import { db } from "./db.js";
import { sendError } from "./http.js";
import { checkAi, connection, JobTimeoutError, QueueUnavailableError } from "./queue.js";
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

// What a request costs against the daily budget (SEC-82): web lookups and
// photo reads are the dearest.
export const AI_COST = { analysis: 1, suggestion: 2, review: 2, label: 3, labelWeb: 5, recap: 2 } as const;
const limit = (name: string, fallback: number): number => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);

// Before queueing a (paid) AI job: requireAi, then counts `cost` against the
// person's and the workspace's daily budget (UTC day; AI_DAILY_USER_UNITS,
// AI_DAILY_WORKSPACE_UNITS). Sends 429 `ai_limit` and returns false when spent.
export async function spendAi(res: Response, workspaceId: string, userId: string, cost: number): Promise<boolean> {
  if (!(await requireAi(res, workspaceId))) return false;
  const day = new Date().toISOString().slice(0, 10);
  const keys: Array<[string, number]> = [
    [`aibudget:${day}:u:${userId}`, limit("AI_DAILY_USER_UNITS", 100)],
    [`aibudget:${day}:w:${workspaceId}`, limit("AI_DAILY_WORKSPACE_UNITS", 300)],
  ];
  try {
    const used: Array<[string, number]> = [];
    for (const [key, cap] of keys) {
      const total = await connection.incrby(key, cost);
      if (total === cost) await connection.expire(key, 36 * 60 * 60);
      used.push([key, cost]);
      if (total > cap) {
        for (const [k, c] of used) await connection.decrby(k, c); // give back: a refused call costs nothing
        sendError(res, 429, "This is over today's AI limit for you or this workspace. Try again tomorrow.", { code: "ai_limit" });
        return false;
      }
    }
  } catch (err) {
    console.error("AI budget check failed, letting the request through:", err instanceof Error ? err.message : err);
  }
  return true;
}

// Before queueing an AI job: sends 409 and returns false when nothing would answer it.
export async function requireAi(res: Response, workspaceId: string): Promise<boolean> {
  if ((await aiStatus(workspaceId)).available) return true;
  sendError(res, 409, "No AI is set up for this workspace (Settings → AI)", { code: "ai_not_configured" });
  return false;
}
