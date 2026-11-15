import { randomUUID } from "node:crypto";
import type { CookieOptions, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { connection } from "../queue.js";

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
  // Per-token id and expiry (unix seconds); older tokens have no id.
  jti: string | null;
  exp: number;
}

export function setSessionCookie(res: Response, userId: string, sessionVersion: number): void {
  const token = jwt.sign({ sv: sessionVersion }, config.jwtSecret, {
    algorithm: "HS256",
    jwtid: randomUUID(),
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
    return { userId: payload.sub, sessionVersion: sv, jti: typeof payload.jti === "string" ? payload.jti : null, exp: typeof payload.exp === "number" ? payload.exp : 0 };
  } catch {
    return null;
  }
}

// SEC-33: logout revokes just this token (other devices stay signed in): its
// id is kept in Redis until the token would have expired anyway. If Redis is
// down, revoking and checking are skipped rather than locking everyone out.
const revokedKey = (jti: string) => `session-revoked:${jti}`;

export async function revokeSession(claims: SessionClaims): Promise<void> {
  const left = claims.exp - Math.floor(Date.now() / 1000);
  if (!claims.jti || left <= 0) return;
  try {
    await connection.set(revokedKey(claims.jti), "1", "EX", left);
  } catch {
    // not revoked; the cookie is still cleared
  }
}

export async function isSessionRevoked(claims: SessionClaims): Promise<boolean> {
  if (!claims.jti) return false;
  try {
    return (await connection.exists(revokedKey(claims.jti))) === 1;
  } catch {
    return false;
  }
}
