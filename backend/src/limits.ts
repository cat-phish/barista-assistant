// Per-person caps on heavy requests (SEC-61): restores and imports each parse
// up to 50-250 MB and write many rows and photo files.
import { count, eq } from "drizzle-orm";
import { workspaceMembers } from "@barista/shared/schema";
import type { Request, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { db } from "./db.js";
import { sendError } from "./http.js";

const num = (name: string, fallback: number): number => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);

// HEAVY_IMPORT_LIMIT_PER_HOUR (default 10), per signed-in person.
export const heavyImportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: () => num("HEAVY_IMPORT_LIMIT_PER_HOUR", 10),
  keyGenerator: (req: Request) => `heavy:${req.userId ?? ipKeyGenerator(req.ip ?? "unknown")}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendError(res, 429, "Too many restores or imports. Try again later.");
  },
});

// MAX_OWNED_WORKSPACES (default 20): sends 409 and returns false at the cap.
export async function underWorkspaceCap(res: Response, userId: string): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  const cap = num("MAX_OWNED_WORKSPACES", 20);
  if ((row?.n ?? 0) >= cap) {
    sendError(res, 409, `You can be in up to ${cap} workspaces. Leave or delete one first.`, { code: "workspace_limit" });
    return false;
  }
  return true;
}
