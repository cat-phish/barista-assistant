import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../auth/password.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { users, type User } from "@barista/shared/schema";
import { emailSchema } from "../validation.js";

export interface PublicUser {
  id: string;
  email: string;
}

export interface UserResponse {
  user: PublicUser;
}

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(256),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

function toPublicUser(user: Pick<User, "id" | "email">): PublicUser {
  return { id: user.id, email: user.email };
}

// Per-IP brute-force protection. In-memory store: fine for a single backend
// instance; move to a Redis store if the backend is ever scaled out.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendError(res, 429, "Too many login attempts. Try again later.");
  },
});

export const authRouter = Router();

authRouter.post("/register", async (req: Request, res: Response<UserResponse>) => {
  const body = parseBody(registerSchema, req, res);
  if (!body) return;

  const user = { id: randomUUID(), email: body.email };
  try {
    await db.insert(users).values({ ...user, passwordHash: await hashPassword(body.password) });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, "Email already registered");
      return;
    }
    throw err;
  }

  setSessionCookie(res, user.id);
  res.status(201).json({ user });
});

authRouter.post("/login", loginLimiter, async (req: Request, res: Response<UserResponse>) => {
  const body = parseBody(loginSchema, req, res);
  if (!body) return;

  const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
  const valid = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) {
    sendError(res, 401, "Invalid email or password");
    return;
  }

  setSessionCookie(res, user.id);
  res.json({ user: toPublicUser(user) });
});

authRouter.post("/logout", (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req: Request, res: Response<UserResponse>) => {
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, authedUserId(req)))
    .limit(1);
  if (!user) {
    // Valid token for a deleted account
    clearSessionCookie(res);
    sendError(res, 401, "Not authenticated");
    return;
  }
  res.json({ user: toPublicUser(user) });
});
