import { users } from "@barista/shared/schema";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { clearSessionCookie, SESSION_COOKIE, verifySessionToken } from "../auth/session.js";
import { db } from "../db.js";
import { sendError } from "../http.js";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}

// Valid signature isn't enough: the token's session version must still match
// the user's (one primary-key lookup), so password changes revoke old sessions
// and tokens of deleted accounts stop working.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const claims = typeof token === "string" ? verifySessionToken(token) : null;
  if (!claims) {
    sendError(res, 401, "Not authenticated");
    return;
  }

  const [user] = await db
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, claims.userId))
    .limit(1);
  if (!user || user.sessionVersion !== claims.sessionVersion) {
    clearSessionCookie(res);
    sendError(res, 401, "Not authenticated");
    return;
  }

  req.userId = claims.userId;
  next();
}

// For handlers mounted behind requireAuth.
export function authedUserId(req: Pick<Request, "userId">): string {
  if (!req.userId) {
    throw new Error("authedUserId called on a route without requireAuth");
  }
  return req.userId;
}
