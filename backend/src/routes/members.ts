import { and, asc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { isRole, requireMembership, type Role } from "../auth/membership.js";
import { deleteMemberChats } from "../chatData.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { createInvite, inviteLimiter, MAX_PENDING_INVITES } from "./invites.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { users, workspaceMembers } from "@barista/shared/schema";
import { emailSchema, roleSchema } from "../validation.js";

export interface Member {
  userId: string;
  email: string;
  name: string | null; // auth.md §1, "Name"
  role: Role;
}

export interface MemberListResponse {
  members: Array<Member & { chatEnabled: boolean }>;
}

export interface MemberResponse {
  member: Member;
}

interface WorkspaceParams {
  workspaceId: string;
}

interface MemberParams extends WorkspaceParams {
  userId: string;
}

const addMemberSchema = z.object({ email: emailSchema, role: roleSchema });
const updateMemberSchema = z.object({ role: roleSchema });

// Mounted at /api/workspaces/:workspaceId/members
export const membersRouter = Router({ mergeParams: true });
membersRouter.use(requireAuth);

membersRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<MemberListResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;

  const rows = await db
    .select({ userId: users.id, email: users.email, name: users.name, role: workspaceMembers.role, chatEnabled: workspaceMembers.chatEnabled })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.email));

  res.json({ members: rows.flatMap((m) => (isRole(m.role) ? [{ ...m, role: m.role }] : [])) });
});

// Invites the email; it joins only when that person accepts (docs/api/workspaces.md
// §2 "Invites"). The same 202 whether or not the email has an account.
membersRouter.post("/", inviteLimiter, async (req: Request, res: Response<{ invited: true }>) => {
  const workspaceId = String(req.params.workspaceId);
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, ["owner"]))) return;

  const body = parseBody(addMemberSchema, req, res);
  if (!body) return;

  if ((await createInvite(workspaceId, body.email, body.role, userId)) === "too_many") {
    sendError(res, 409, `Too many pending invites (up to ${MAX_PENDING_INVITES}). Cancel some first.`);
    return;
  }
  res.status(202).json({ invited: true });
});

membersRouter.patch("/:userId", async (req: Request<MemberParams>, res: Response<MemberResponse>) => {
  const { workspaceId, userId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;

  const body = parseBody(updateMemberSchema, req, res);
  if (!body) return;

  // Lock this workspace's member rows so concurrent demotions can't both pass
  // the "another owner remains" check.
  const outcome = await db.transaction(async (tx) => {
    const members = await tx
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .for("update");

    const target = members.find((m) => m.userId === userId);
    if (!target) return "not_found" as const;

    const ownerCount = members.filter((m) => m.role === "owner").length;
    if (target.role === "owner" && body.role !== "owner" && ownerCount <= 1) {
      return "last_owner" as const;
    }

    await tx
      .update(workspaceMembers)
      .set({ role: body.role })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    return "updated" as const;
  });

  if (outcome === "not_found") {
    sendError(res, 404, "That user is not a member");
    return;
  }
  if (outcome === "last_owner") {
    sendError(res, 409, "A workspace must keep at least one owner");
    return;
  }

  const [user] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  res.json({ member: { userId, email: user?.email ?? "", name: user?.name ?? null, role: body.role } });
});

// AI chat for this member (docs/api/chat.md §12).
const chatSchema = z.object({ enabled: z.boolean() }).strict();
membersRouter.put("/:userId/chat", async (req: Request<MemberParams>, res: Response<{ userId: string; chatEnabled: boolean }>) => {
  const { workspaceId, userId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const body = parseBody(chatSchema, req, res);
  if (!body) return;
  const where = and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId));
  const [member] = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(where);
  if (!member) {
    sendError(res, 404, "That user is not a member");
    return;
  }
  await db.update(workspaceMembers).set({ chatEnabled: body.enabled }).where(where);
  res.json({ userId, chatEnabled: body.enabled });
});

// Owners can remove anyone; any member can remove themselves (leave).
membersRouter.delete("/:userId", async (req: Request<MemberParams>, res: Response) => {
  const { workspaceId, userId } = req.params;
  const callerId = authedUserId(req);
  const callerRole = await requireMembership(res, callerId, workspaceId);
  if (!callerRole) return;
  if (callerRole !== "owner" && callerId !== userId) {
    sendError(res, 403, "Only owners can remove other members");
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const members = await tx
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .for("update");

    const target = members.find((m) => m.userId === userId);
    if (!target) return "not_found" as const;

    const ownerCount = members.filter((m) => m.role === "owner").length;
    if (target.role === "owner" && ownerCount <= 1) return "last_owner" as const;

    await tx
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    return "deleted" as const;
  });

  if (outcome === "not_found") {
    sendError(res, 404, "That user is not a member");
    return;
  }
  if (outcome === "last_owner") {
    sendError(res, 409, "A workspace must keep at least one owner");
    return;
  }
  await deleteMemberChats(workspaceId, userId);
  res.status(204).end();
});
