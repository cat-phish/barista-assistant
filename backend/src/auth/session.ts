import type { CookieOptions, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: config.isProduction,
  path: "/",
};

export interface SessionClaims {
  userId: string;
  // users.session_version when the token was issued; a mismatch means the
  // session was revoked (e.g. password changed).
  sessionVersion: number;
}

export function setSessionCookie(res: Response, userId: string, sessionVersion: number): void {
  const token = jwt.sign({ sv: sessionVersion }, config.jwtSecret, {
    algorithm: "HS256",
    subject: userId,
    expiresIn: SESSION_TTL_SECONDS,
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: SESSION_TTL_SECONDS * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

// Returns the claims of a valid token, or null if missing, expired or forged.
// Doesn't check revocation; requireAuth compares sessionVersion with the DB.
export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || typeof payload.sub !== "string") return null;
    const sv: unknown = payload.sv;
    if (typeof sv !== "number" || !Number.isInteger(sv)) return null;
    return { userId: payload.sub, sessionVersion: sv };
  } catch {
    return null;
  }
}
