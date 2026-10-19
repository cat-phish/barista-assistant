import { and, eq } from "drizzle-orm";
import type { Response } from "express";
import { db } from "../db.js";
import { sendError } from "../http.js";
import { beans, brewLogs, workspaceMembers } from "@barista/shared/schema";

export const ROLES = ["owner", "barista", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const WRITE_ROLES: readonly Role[] = ["owner", "barista"];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

// Returns the caller's role in the workspace, or sends 404 (not a member) /
// 403 (role not allowed) and returns null. 404 hides whether the workspace exists.
export async function requireMembership(
  res: Response,
  userId: string,
  workspaceId: string,
  allowedRoles: readonly Role[] = ROLES
): Promise<Role | null> {
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);

  if (!member || !isRole(member.role)) {
    sendError(res, 404, "Workspace not found");
    return null;
  }
  if (!allowedRoles.includes(member.role)) {
    sendError(res, 403, "Your role does not allow this action");
    return null;
  }
  return member.role;
}

export interface ResourceAccess {
  workspaceId: string;
  role: Role;
}

const resourceTables = {
  bean: { table: beans, id: beans.id, workspaceId: beans.workspaceId, notFound: "Bean not found" },
  brewLog: { table: brewLogs, id: brewLogs.id, workspaceId: brewLogs.workspaceId, notFound: "Brew log not found" },
} as const;

// For routes whose URL names a resource but not its workspace
// (/api/beans/:beanId/..., /api/brew-logs/:brewLogId/...). Finds the resource
// and the caller's membership in ONE query, so "doesn't exist" and "exists but
// you're not a member" run the same query and return the same 404 -- neither
// the body nor the response time reveals that the resource exists.
// Sends 404/403 and returns null on failure, like requireMembership.
export async function requireResourceMembership(
  res: Response,
  userId: string,
  kind: keyof typeof resourceTables,
  resourceId: string,
  allowedRoles: readonly Role[] = ROLES
): Promise<ResourceAccess | null> {
  const t = resourceTables[kind];
  const [row] = await db
    .select({ workspaceId: t.workspaceId, role: workspaceMembers.role })
    .from(t.table)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, t.workspaceId), eq(workspaceMembers.userId, userId))
    )
    .where(eq(t.id, resourceId))
    .limit(1);

  if (!row || !isRole(row.role)) {
    sendError(res, 404, t.notFound);
    return null;
  }
  // Only members get here, so a 403 reveals nothing they can't already see.
  if (!allowedRoles.includes(row.role)) {
    sendError(res, 403, "Your role does not allow this action");
    return null;
  }
  return { workspaceId: row.workspaceId, role: row.role };
}
