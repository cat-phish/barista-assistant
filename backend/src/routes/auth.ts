import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../auth/password.js";
import { clearSessionCookie, setSessionCookie } from "../auth/session.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  DEFAULT_PREFERENCES,
  users,
  withDefaults,
  workspaceMembers,
  workspaces,
  type User,
  type UserPreferences,
  type Workspace,
} from "@barista/shared/schema";
import { emailSchema, preferencesSchema } from "../validation.js";

export interface PublicUser {
  id: string;
  email: string;
  preferences: UserPreferences; // defaults filled in
}

export interface PreferencesResponse {
  preferences: UserPreferences;
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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(256),
});

export interface SoleOwnerConflict {
  error: string;
  workspaces: Array<Pick<Workspace, "id" | "name" | "slug">>;
}

function toPublicUser(user: Pick<User, "id" | "email"> & { preferences?: User["preferences"] }): PublicUser {
  return { id: user.id, email: user.email, preferences: withDefaults(DEFAULT_PREFERENCES, user.preferences ?? null) };
}

// Per-IP brute-force protection, shared by every endpoint that checks a
// password (login, change password, delete account), so guesses across them
// count together. In-memory store: fine for a single backend instance; move
// to a Redis store if the backend is ever scaled out.
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

  setSessionCookie(res, user.id, 0); // new users start at session_version 0
  res.status(201).json({ user: toPublicUser(user) });
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

  setSessionCookie(res, user.id, user.sessionVersion);
  res.json({ user: toPublicUser(user) });
});

authRouter.post("/logout", (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req: Request, res: Response<UserResponse>) => {
  const [user] = await db
    .select({ id: users.id, email: users.email, preferences: users.preferences })
    .from(users)
    .where(eq(users.id, authedUserId(req)))
    .limit(1);
  if (!user) {
    // Deleted between requireAuth's check and this query
    clearSessionCookie(res);
    sendError(res, 401, "Not authenticated");
    return;
  }
  res.json({ user: toPublicUser(user) });
});

// The caller's display preferences; the body's keys are merged into what's
// stored (docs/api/auth.md §1).
authRouter.patch("/me/preferences", requireAuth, async (req: Request, res: Response<PreferencesResponse>) => {
  const body = parseBody(preferencesSchema, req, res);
  if (!body) return;

  const userId = authedUserId(req);
  const preferences = await db.transaction(async (tx) => {
    const [row] = await tx.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId)).for("update");
    if (!row) return null;
    const merged = { ...(row.preferences ?? {}), ...body };
    await tx.update(users).set({ preferences: merged }).where(eq(users.id, userId));
    return merged;
  });
  if (!preferences) {
    clearSessionCookie(res);
    sendError(res, 401, "Not authenticated");
    return;
  }
  res.json({ preferences: withDefaults(DEFAULT_PREFERENCES, preferences) });
});

// Changing the password bumps session_version, which revokes every other
// session; this device gets a fresh cookie. A wrong current password is 403,
// not 401, so the frontend doesn't treat a typo as being logged out.
authRouter.post("/password", requireAuth, loginLimiter, async (req: Request, res: Response) => {
  const body = parseBody(changePasswordSchema, req, res);
  if (!body) return;
  if (body.newPassword === body.currentPassword) {
    sendError(res, 400, "newPassword: must be different from the current password");
    return;
  }

  const userId = authedUserId(req);
  const outcome = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) return { status: "gone" } as const;
    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) return { status: "wrong" } as const;

    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, userId));
    const [updated] = await tx.select({ sessionVersion: users.sessionVersion }).from(users).where(eq(users.id, userId));
    return { status: "changed", sessionVersion: updated?.sessionVersion ?? 0 } as const;
  });

  if (outcome.status === "gone") {
    clearSessionCookie(res);
    sendError(res, 401, "Not authenticated");
    return;
  }
  if (outcome.status === "wrong") {
    sendError(res, 403, "Current password is incorrect");
    return;
  }
  setSessionCookie(res, userId, outcome.sessionVersion);
  res.status(204).end();
});

// Memberships cascade; brew logs are kept with user_id set to null. Refused
// (and nothing deleted) while the caller is the only owner of any workspace.
authRouter.delete("/me", requireAuth, loginLimiter, async (req: Request, res: Response<SoleOwnerConflict>) => {
  const body = parseBody(deleteAccountSchema, req, res);
  if (!body) return;

  const userId = authedUserId(req);
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!user) {
    clearSessionCookie(res);
    sendError(res, 401, "Not authenticated");
    return;
  }
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    sendError(res, 403, "Password is incorrect");
    return;
  }

  const soleOwned = await db.transaction(async (tx) => {
    const owned = await tx
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, "owner")))
      .for("update");
    const ownedIds = owned.map((m) => m.workspaceId);

    let soleIds: string[] = [];
    if (ownedIds.length > 0) {
      // Lock all owner rows of those workspaces, like the member role/removal
      // endpoints do, so a concurrent demotion can't slip past this check.
      const owners = await tx
        .select({ workspaceId: workspaceMembers.workspaceId })
        .from(workspaceMembers)
        .where(and(inArray(workspaceMembers.workspaceId, ownedIds), eq(workspaceMembers.role, "owner")))
        .for("update");
      const ownerCount = new Map<string, number>();
      for (const o of owners) ownerCount.set(o.workspaceId, (ownerCount.get(o.workspaceId) ?? 0) + 1);
      soleIds = ownedIds.filter((id) => ownerCount.get(id) === 1);
    }

    if (soleIds.length > 0) {
      return tx
        .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(inArray(workspaces.id, soleIds));
    }

    await tx.delete(users).where(eq(users.id, userId));
    return [];
  });

  if (soleOwned.length > 0) {
    res.status(409).json({
      error:
        "You are the only owner of these workspaces. Make someone else an owner or delete them first.",
      workspaces: soleOwned,
    });
    return;
  }
  clearSessionCookie(res);
  res.status(204).end();
});
