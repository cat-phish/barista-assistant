import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../auth/password.js";
import { clearSessionCookie, revokeSession, SESSION_COOKIE, setSessionCookie, verifySessionToken } from "../auth/session.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  DEFAULT_PREFERENCES,
  users,
  withDefaults,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  type User,
  type UserPreferences,
  type Workspace,
} from "@barista/shared/schema";
import { emailSchema, preferencesSchema } from "../validation.js";
import { emailVerificationOn, registrationMode, registrationOpen } from "../config.js";
import { fresh } from "./invites.js";
import { sendMail } from "../mail.js";
import { sendVerification } from "./emailVerification.js";

export interface PublicUser {
  id: string;
  email: string;
  name: string | null; // what others see; null: not set (auth.md §1, "Name")
  preferences: UserPreferences; // defaults filled in
  emailVerified: boolean; // docs/api/auth.md §1d; always false while the server has verification off
  isAdmin: boolean; // a server admin, granted on the server (docs/api/server.md §10)
}

export interface PreferencesResponse {
  preferences: UserPreferences;
}

export interface UserResponse {
  user: PublicUser;
}

// SEC-36: the most-guessed passwords that pass the 8-character minimum.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop",
  "11111111", "00000000", "iloveyou", "letmein1", "welcome1", "admin123", "abc12345", "monkey123", "dragon123", "football1", "baseball1", "coffee123",
]);
const strongPassword = z.string().min(8).max(256).refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), "is too common; pick another");

const registerSchema = z.object({
  email: emailSchema,
  password: strongPassword,
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: strongPassword,
});

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(256),
});

export interface SoleOwnerConflict {
  error: string;
  workspaces: Array<Pick<Workspace, "id" | "name" | "slug">>;
}

function toPublicUser(user: Pick<User, "id" | "email"> & { name?: string | null; preferences?: User["preferences"]; isAdmin?: boolean; emailVerifiedAt?: Date | null }): PublicUser {
  return { id: user.id, email: user.email, name: user.name ?? null, preferences: withDefaults(DEFAULT_PREFERENCES, user.preferences ?? null), emailVerified: Boolean(user.emailVerifiedAt), isAdmin: user.isAdmin ?? false };
}

// Brute-force protection, shared by every endpoint that checks a password
// (login, change password, delete account, backup download), so guesses
// across them count together. Two buckets (SEC-31): one per account (the
// email in the body, else the signed-in user), so a guesser on any number of
// IPs is capped and one account's failures never lock out another; and a
// looser one per IP, for a client trying many accounts. In-memory stores:
// fine for a single backend instance; move to Redis if it's scaled out.
const limiterOptions = {
  windowMs: 15 * 60 * 1000,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendError(res, 429, "Too many login attempts. Try again later.");
  },
};

// The same key whether the email comes in the body (login) or from the
// signed-in user (password change, delete, backup download), so guesses
// across them count together.
async function accountKey(req: Request): Promise<string> {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email === "string" && email) return `email:${email.trim().toLowerCase()}`;
  if (req.userId) {
    const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.userId));
    if (me) return `email:${me.email}`;
  }
  return `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
}

export const loginLimiter = [
  rateLimit({ ...limiterOptions, limit: 10, keyGenerator: accountKey }),
  rateLimit({ ...limiterOptions, limit: 60 }),
];


// SEC-30: sign-ups per IP. Each one costs a scrypt hash and a users row, so
// open registration needs a cap. In-memory store, like loginLimiter.
function registerLimit(): number {
  const n = Number(process.env.REGISTER_LIMIT_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: registerLimit(),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendError(res, 429, "Too many sign-ups from this address. Try again later.");
  },
});

export const authRouter = Router();

// Whether anyone can create an account here (ALLOW_REGISTRATION), so the
// app can say so before the form is filled in.
authRouter.get("/registration", (_req: Request, res: Response<{ open: boolean; inviteOnly: boolean; emailVerification: boolean }>) => {
  res.json({ open: registrationOpen(), inviteOnly: registrationMode() === "invite", emailVerification: emailVerificationOn() });
});

authRouter.post("/register", registerLimiter, async (req: Request, res: Response<UserResponse | { pending: true }>) => {
  if (!registrationOpen()) {
    sendError(res, 403, "Registration is closed on this server");
    return;
  }
  const body = parseBody(registerSchema, req, res);
  if (!body) return;
  if (registrationMode() === "invite") {
    const [invite] = await db.select({ id: workspaceInvites.id }).from(workspaceInvites).where(and(eq(workspaceInvites.email, body.email.toLowerCase()), fresh())).limit(1);
    if (!invite) {
      sendError(res, 403, "Sign-up on this server needs an invitation to a workspace, sent to this email");
      return;
    }
  }

  const user = { id: randomUUID(), email: body.email };
  const passwordHash = await hashPassword(body.password);
  try {
    await db.insert(users).values({ ...user, passwordHash });
  } catch (err) {
    if (!isDuplicateEntryError(err)) throw err;
    // With verification on (so mail works) the reply doesn't say whether the
    // address is taken (SEC-32); the owner of it gets a mail instead.
    if (emailVerificationOn()) {
      void sendMail({ to: body.email, subject: "Someone tried to sign up with your email", text: "Someone tried to create a Barista-Assistant account with this address, which already has one. If it was you, sign in, or reset your password if you've forgotten it. If not, ignore this mail." }).catch(() => undefined);
      res.status(202).json({ pending: true });
      return;
    }
    sendError(res, 409, "Email already registered");
    return;
  }

  void sendVerification(user); // no-op unless the server has verification on
  if (emailVerificationOn()) {
    res.status(202).json({ pending: true }); // no session until they sign in (after confirming)
    return;
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

authRouter.post("/logout", async (req: Request, res: Response) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const claims = typeof token === "string" ? verifySessionToken(token) : null;
  if (claims) await revokeSession(claims); // SEC-33
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req: Request, res: Response<UserResponse>) => {
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, preferences: users.preferences, isAdmin: users.isAdmin, emailVerifiedAt: users.emailVerifiedAt })
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

// The caller's name, shown to others instead of their email (docs/api/auth.md
// §1, "Name"). Blank or null clears it. The email stays the login.
const profileSchema = z.object({ name: z.string().max(100).nullable() }).strict();
authRouter.patch("/me", requireAuth, async (req: Request, res: Response<UserResponse>) => {
  const body = parseBody(profileSchema, req, res);
  if (!body) return;
  const userId = authedUserId(req);
  const name = body.name?.trim().replace(/\s+/g, " ") || null;
  await db.update(users).set({ name }).where(eq(users.id, userId));
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, preferences: users.preferences, isAdmin: users.isAdmin, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
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
