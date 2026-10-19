import { and, asc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { isRole, requireMembership, type Role } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { users, workspaceMembers } from "@barista/shared/schema";
import { emailSchema, roleSchema } from "../validation.js";

export interface Member {
  userId: string;
  email: string;
  role: Role;
}

export interface MemberListResponse {
  members: Member[];
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
    .select({ userId: users.id, email: users.email, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.email));

  res.json({ members: rows.flatMap((m) => (isRole(m.role) ? [{ ...m, role: m.role }] : [])) });
});

membersRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<MemberResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;

  const body = parseBody(addMemberSchema, req, res);
  if (!body) return;

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);
  if (!user) {
    sendError(res, 404, "No registered user with that email");
    return;
  }

  try {
    await db.insert(workspaceMembers).values({ userId: user.id, workspaceId, role: body.role });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, "That user is already a member");
      return;
    }
    throw err;
  }

  res.status(201).json({ member: { userId: user.id, email: user.email, role: body.role } });
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

  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  res.json({ member: { userId, email: user?.email ?? "", role: body.role } });
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
  res.status(204).end();
});
