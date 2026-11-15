// Email verification (docs/api/auth.md §1d). Only when EMAIL_VERIFICATION=true.
// A token is 256 random bits; only its SHA-256 is stored, with the address it
// was sent to. The link carries it in the URL fragment, so it isn't sent to
// the server in a GET, logged, or passed on in a Referer; the page posts it.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { emailTokens, users } from "@barista/shared/schema";
import { appUrl, emailVerificationOn } from "../config.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { sendMail } from "../mail.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";

const VERIFY_HOURS = 24;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

// Mails a fresh link and cancels the older ones. Never throws: a failed send
// is logged, and the person can ask again.
export async function sendVerification(user: { id: string; email: string }): Promise<void> {
  if (!emailVerificationOn()) return;
  try {
    const token = randomBytes(32).toString("base64url");
    await db.delete(emailTokens).where(and(eq(emailTokens.userId, user.id), eq(emailTokens.purpose, "verify")));
    await db.insert(emailTokens).values({
      id: randomUUID(),
      userId: user.id,
      purpose: "verify",
      email: user.email,
      tokenHash: hash(token),
      expiresAt: sql`(now() + interval ${sql.raw(String(VERIFY_HOURS))} hour)`,
    });
    await sendMail({
      to: user.email,
      subject: "Confirm your email for Barista-Assistant",
      text: `Open this link to confirm ${user.email} (it works once, for ${VERIFY_HOURS} hours):\n\n${appUrl()}/verify-email#${token}\n\nIf you didn't sign up, ignore this mail.`,
    });
  } catch (err) {
    console.error("Sending the verification mail failed:", err instanceof Error ? err.message : err);
  }
}

const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req: Request) => `verify:${req.userId ?? "x"}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => sendError(res, 429, "Too many mails. Try again later."),
});
const redeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => sendError(res, 429, "Too many attempts. Try again later."),
});

export const emailVerifyRouter = Router();

// Mail me a new link.
emailVerifyRouter.post("/verify-email/send", requireAuth, sendLimiter, async (req: Request, res: Response) => {
  if (!emailVerificationOn()) {
    sendError(res, 404, "Email verification is off on this server");
    return;
  }
  const [me] = await db.select({ id: users.id, email: users.email, verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, authedUserId(req)));
  if (me && !me.verifiedAt) await sendVerification(me);
  res.status(204).end();
});

const redeemSchema = z.object({ token: z.string().min(20).max(100) }).strict();

// Confirm with the mailed token. The same 400 for unknown, used, expired.
emailVerifyRouter.post("/verify-email", redeemLimiter, async (req: Request, res: Response) => {
  if (!emailVerificationOn()) {
    sendError(res, 404, "Email verification is off on this server");
    return;
  }
  const body = parseBody(redeemSchema, req, res);
  if (!body) return;
  const ok = await db.transaction(async (tx) => {
    // One atomic claim: only a single redeem can flip used_at.
    const [claimed] = await tx
      .update(emailTokens)
      .set({ usedAt: sql`now()` })
      .where(and(eq(emailTokens.tokenHash, hash(body.token)), eq(emailTokens.purpose, "verify"), isNull(emailTokens.usedAt), gt(emailTokens.expiresAt, sql`now()`)));
    if (claimed.affectedRows !== 1) return false;
    const [row] = await tx.select({ userId: emailTokens.userId, email: emailTokens.email }).from(emailTokens).where(eq(emailTokens.tokenHash, hash(body.token)));
    if (!row) return false;
    // Only if the account still has the address the mail went to.
    const [result] = await tx.update(users).set({ emailVerifiedAt: sql`now()` }).where(and(eq(users.id, row.userId), eq(users.email, row.email)));
    return result.affectedRows === 1;
  });
  if (!ok) {
    sendError(res, 400, "This link is no longer valid");
    return;
  }
  res.status(204).end();
});
