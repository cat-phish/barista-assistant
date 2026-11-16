// Invites to a workspace (docs/api/workspaces.md §2 "Invites", SEC-01).
// An owner invites an email; nothing changes for that person until they
// accept. The invite reply never says whether the email has an account.
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, gt, lt, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { users, workspaceInvites, workspaceMembers, workspaces } from "@barista/shared/schema";
import { isRole, requireMembership, type Role } from "../auth/membership.js";
import { emailVerificationOn } from "../config.js";
import { db } from "../db.js";
import { isDuplicateEntryError, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";

export const INVITE_DAYS = 14;
export const MAX_PENDING_INVITES = 50;
export const fresh = () => gt(workspaceInvites.createdAt, sql`(now() - interval ${sql.raw(String(INVITE_DAYS))} day)`);

export interface WorkspaceInviteSummary {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface MyInvite {
  id: string;
  workspace: { name: string; slug: string };
  role: Role;
  invitedBy: string | null; // their email
  createdAt: string;
}

// Inviting is capped per signed-in person: an owner has no reason to send
// dozens an hour, and each is a row (SEC-01).
export const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.INVITE_LIMIT_PER_HOUR) > 0 ? Number(process.env.INVITE_LIMIT_PER_HOUR) : 30,
  keyGenerator: (req: Request) => `invite:${req.userId ?? ipKeyGenerator(req.ip ?? "unknown")}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendError(res, 429, "Too many invites. Try again later.");
  },
});

// Creates (or re-sends with the new role) the invite. Always the same answer.
export async function createInvite(workspaceId: string, email: string, role: Role, invitedBy: string): Promise<"ok" | "too_many"> {
  await db.delete(workspaceInvites).where(and(eq(workspaceInvites.workspaceId, workspaceId), lt(workspaceInvites.createdAt, sql`(now() - interval ${sql.raw(String(INVITE_DAYS))} day)`)));
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(workspaceInvites).where(eq(workspaceInvites.workspaceId, workspaceId));
  const [existing] = await db.select({ id: workspaceInvites.id }).from(workspaceInvites).where(and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.email, email)));
  if (!existing && n >= MAX_PENDING_INVITES) return "too_many";
  // Someone already in: nothing to do, and the answer stays the same.
  const [member] = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, workspaceId)))
    .where(eq(users.email, email));
  if (member) return "ok";
  if (existing) {
    await db.update(workspaceInvites).set({ role, invitedBy, createdAt: sql`now()` }).where(eq(workspaceInvites.id, existing.id));
  } else {
    await db.insert(workspaceInvites).values({ id: randomUUID(), workspaceId, email, role, invitedBy });
  }
  return "ok";
}

interface WorkspaceParams {
  workspaceId: string;
}
interface InviteParams extends WorkspaceParams {
  inviteId: string;
}

// Mounted at /api/workspaces/:workspaceId/invites (owners)
export const workspaceInvitesRouter = Router({ mergeParams: true });
workspaceInvitesRouter.use(requireAuth);

workspaceInvitesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ invites: WorkspaceInviteSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const rows = await db
    .select({ id: workspaceInvites.id, email: workspaceInvites.email, role: workspaceInvites.role, createdAt: workspaceInvites.createdAt })
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.workspaceId, workspaceId), fresh()))
    .orderBy(asc(workspaceInvites.email));
  res.json({ invites: rows.flatMap((r) => (isRole(r.role) ? [{ ...r, role: r.role, createdAt: r.createdAt.toISOString() }] : [])) });
});

workspaceInvitesRouter.delete("/:inviteId", async (req: Request<InviteParams>, res: Response) => {
  const { workspaceId, inviteId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const [result] = await db.delete(workspaceInvites).where(and(eq(workspaceInvites.id, inviteId), eq(workspaceInvites.workspaceId, workspaceId)));
  if (result.affectedRows === 0) {
    sendError(res, 404, "No such invite");
    return;
  }
  res.status(204).end();
});

// Mounted at /api/invites (the invited person)
export const myInvitesRouter = Router();
myInvitesRouter.use(requireAuth);

async function myEmail(userId: string): Promise<string> {
  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!me) throw new Error("Signed-in user missing");
  return me.email;
}

myInvitesRouter.get("/", async (req: Request, res: Response<{ invites: MyInvite[] }>) => {
  const email = await myEmail(authedUserId(req));
  const rows = await db
    .select({
      id: workspaceInvites.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceInvites.role,
      invitedBy: users.email,
      createdAt: workspaceInvites.createdAt,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvites.invitedBy))
    .where(and(eq(workspaceInvites.email, email), fresh()))
    .orderBy(asc(workspaceInvites.createdAt));
  res.json({
    invites: rows.flatMap((r) => (isRole(r.role) ? [{ id: r.id, workspace: { name: r.name, slug: r.slug }, role: r.role, invitedBy: r.invitedBy, createdAt: r.createdAt.toISOString() }] : [])),
  });
});

myInvitesRouter.post("/:inviteId/accept", async (req: Request<{ inviteId: string }>, res: Response<{ workspace: { id: string; name: string; slug: string }; role: Role }>) => {
  const userId = authedUserId(req);
  const email = await myEmail(userId);
  // With verification on, only an address the person has confirmed can claim
  // an invite sent to it (docs/api/workspaces.md §2 "Invites").
  if (emailVerificationOn()) {
    const [me] = await db.select({ verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
    if (!me?.verifiedAt) {
      sendError(res, 403, "Confirm your email address first: we sent you a link.");
      return;
    }
  }
  const [invite] = await db
    .select({ id: workspaceInvites.id, workspaceId: workspaceInvites.workspaceId, role: workspaceInvites.role })
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.id, req.params.inviteId), eq(workspaceInvites.email, email), fresh()));
  if (!invite || !isRole(invite.role)) {
    sendError(res, 404, "No such invite");
    return;
  }
  try {
    await db.insert(workspaceMembers).values({ userId, workspaceId: invite.workspaceId, role: invite.role });
  } catch (err) {
    if (!isDuplicateEntryError(err)) throw err; // already in: just clear the invite
  }
  await db.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id));
  const [ws] = await db.select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, invite.workspaceId));
  if (!ws) throw new Error("Invited workspace missing");
  res.json({ workspace: ws, role: invite.role });
});

myInvitesRouter.delete("/:inviteId", async (req: Request<{ inviteId: string }>, res: Response) => {
  const email = await myEmail(authedUserId(req));
  const [result] = await db.delete(workspaceInvites).where(and(eq(workspaceInvites.id, req.params.inviteId), eq(workspaceInvites.email, email)));
  if (result.affectedRows === 0) {
    sendError(res, 404, "No such invite");
    return;
  }
  res.status(204).end();
});
