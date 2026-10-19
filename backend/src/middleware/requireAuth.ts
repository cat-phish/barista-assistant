import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE, verifySessionToken } from "../auth/session.js";
import { sendError } from "../http.js";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const userId = typeof token === "string" ? verifySessionToken(token) : null;
  if (!userId) {
    sendError(res, 401, "Not authenticated");
    return;
  }
  req.userId = userId;
  next();
}

// For handlers mounted behind requireAuth.
export function authedUserId(req: Pick<Request, "userId">): string {
  if (!req.userId) {
    throw new Error("authedUserId called on a route without requireAuth");
  }
  return req.userId;
}
