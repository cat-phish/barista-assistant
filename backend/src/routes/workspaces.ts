import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { isRole, requireMembership, type Role } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, parseQuery, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  beanProcesses,
  brewers,
  DEFAULT_BREWERS,
  DEFAULT_WORKSPACE_SETTINGS,
  withDefaults,
  type WorkspaceSettings,
  DEFAULT_PREP_TOOLS,
  prepTools,
  workspaceMembers,
  workspaces,
  type Workspace,
} from "@barista/shared/schema";
import { SLUG_PATTERN, workspaceSettingsSchema } from "../validation.js";
import { defaultProcessRows } from "./beanProcesses.js";

// A workspace as the API returns it: settings with the defaults filled in.
export type WorkspaceView = Omit<Workspace, "settings"> & { settings: WorkspaceSettings };

export interface WorkspaceResponse {
  workspace: WorkspaceView;
}

export interface WorkspaceListResponse {
  workspaces: Array<WorkspaceView & { role: Role }>;
}

export interface WorkspaceSettingsResponse {
  settings: WorkspaceSettings;
}

function toView(workspace: Workspace): WorkspaceView {
  return { ...workspace, settings: withDefaults(DEFAULT_WORKSPACE_SETTINGS, workspace.settings) };
}

const slugSchema = z.string().regex(SLUG_PATTERN, "must be 3-64 lowercase letters, digits or hyphens");

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: slugSchema,
});

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

workspacesRouter.post("/", async (req: Request, res: Response<WorkspaceResponse>) => {
  const body = parseBody(createWorkspaceSchema, req, res);
  if (!body) return;

  const userId = authedUserId(req);
  const workspaceId = randomUUID();

  let workspace: Workspace | undefined;
  try {
    workspace = await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id: workspaceId, name: body.name, slug: body.slug });
      await tx.insert(workspaceMembers).values({ userId, workspaceId, role: "owner" });
      await tx.insert(brewers).values(
        DEFAULT_BREWERS.map(({ name, kind }) => ({ id: randomUUID(), workspaceId, name, kind }))
      );
      await tx.insert(prepTools).values(
        DEFAULT_PREP_TOOLS.map(({ name, methodKind }, i) => ({ id: randomUUID(), workspaceId, name, methodKind, position: i + 1 }))
      );
      await tx.insert(beanProcesses).values(defaultProcessRows(workspaceId));
      const [created] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      return created;
    });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, "Slug already taken");
      return;
    }
    throw err;
  }

  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} missing after insert`);
  }
  res.status(201).json({ workspace: toView(workspace) });
});

workspacesRouter.get("/", async (req: Request, res: Response<WorkspaceListResponse>) => {
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, authedUserId(req)))
    .orderBy(workspaces.name);

  res.json({
    workspaces: rows.flatMap(({ workspace, role }) => (isRole(role) ? [{ ...toView(workspace), role }] : [])),
  });
});

const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    // Changing it moves the public menu: the old /menu/:slug stops working (§2).
    slug: slugSchema.optional(),
    isPublicMenuEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

workspacesRouter.patch(
  "/:workspaceId",
  async (req: Request<{ workspaceId: string }>, res: Response<WorkspaceResponse>) => {
    const { workspaceId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;

    const body = parseBody(updateWorkspaceSchema, req, res);
    if (!body) return;

    try {
      await db.update(workspaces).set(body).where(eq(workspaces.id, workspaceId));
    } catch (err) {
      if (isDuplicateEntryError(err)) {
        sendError(res, 409, "Slug already taken");
        return;
      }
      throw err;
    }
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!workspace) {
      // Deleted between the membership check and now
      sendError(res, 404, "Workspace not found");
      return;
    }
    res.json({ workspace: toView(workspace) });
  }
);

// Owners change the workspace's settings; the body's keys are merged into
// what's stored (docs/api/workspaces.md §2).
workspacesRouter.patch(
  "/:workspaceId/settings",
  async (req: Request<{ workspaceId: string }>, res: Response<WorkspaceSettingsResponse>) => {
    const { workspaceId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;

    const body = parseBody(workspaceSettingsSchema, req, res);
    if (!body) return;

    const settings = await db.transaction(async (tx) => {
      const [row] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).for("update");
      if (!row) return null;
      const merged = { ...(row.settings ?? {}), ...body };
      await tx.update(workspaces).set({ settings: merged }).where(eq(workspaces.id, workspaceId));
      return merged;
    });
    if (!settings) {
      sendError(res, 404, "Workspace not found");
      return;
    }
    res.json({ settings: withDefaults(DEFAULT_WORKSPACE_SETTINGS, settings) });
  }
);

const deleteWorkspaceQuery = z.object({ confirm: z.string().optional() });

// Cascades to members, brewers, beans, recipes, brew logs and analyses.
// ?confirm must be the slug as typed by the owner (docs/api/workspaces.md §2).
workspacesRouter.delete("/:workspaceId", async (req: Request<{ workspaceId: string }>, res: Response) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;

  const query = parseQuery(deleteWorkspaceQuery, req, res);
  if (!query) return;

  const outcome = await db.transaction(async (tx) => {
    const [workspace] = await tx
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .for("update");
    if (!workspace) return "not_found" as const;
    if (query.confirm !== workspace.slug) return "unconfirmed" as const;
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
    return "deleted" as const;
  });

  if (outcome === "not_found") {
    sendError(res, 404, "Workspace not found");
    return;
  }
  if (outcome === "unconfirmed") {
    sendError(res, 400, "confirm: must equal the workspace's slug");
    return;
  }
  res.status(204).end();
});
