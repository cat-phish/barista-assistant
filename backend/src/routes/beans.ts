import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { beans, brewLogs, type Bean } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

export interface BeanListResponse {
  beans: Bean[];
}

export interface BeanResponse {
  bean: Bean;
}

interface WorkspaceParams {
  workspaceId: string;
}

const beanFields = {
  roasterName: z.string().trim().min(1).max(255),
  beanName: z.string().trim().min(1).max(255),
  process: optionalText(100),
  roastDate: z
    .union([z.iso.date(), z.iso.datetime()])
    .nullable()
    .transform((s) => (s ? new Date(s) : null))
    .optional(),
  inventoryWeightGrams: z.number().int().min(0).max(1_000_000),
  showOnPublicMenu: z.boolean(),
};

const createBeanSchema = z.object({
  ...beanFields,
  inventoryWeightGrams: beanFields.inventoryWeightGrams.default(0),
  showOnPublicMenu: beanFields.showOnPublicMenu.default(true),
});

const updateBeanSchema = updateSchema(beanFields);

interface BeanParams extends WorkspaceParams {
  beanId: string;
}

function beanInWorkspace(params: BeanParams) {
  return and(eq(beans.id, params.beanId), eq(beans.workspaceId, params.workspaceId));
}

// Mounted at /api/workspaces/:workspaceId/beans
export const beansRouter = Router({ mergeParams: true });
beansRouter.use(requireAuth);

beansRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<BeanListResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;

  const rows = await db
    .select()
    .from(beans)
    .where(eq(beans.workspaceId, workspaceId))
    .orderBy(asc(beans.roasterName), asc(beans.beanName));

  res.json({ beans: rows });
});

beansRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<BeanResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

  const body = parseBody(createBeanSchema, req, res);
  if (!body) return;

  const id = randomUUID();
  await db.insert(beans).values({ id, workspaceId, ...body });
  const [bean] = await db.select().from(beans).where(eq(beans.id, id));
  if (!bean) {
    throw new Error(`Bean ${id} missing after insert`);
  }
  res.status(201).json({ bean });
});

beansRouter.patch("/:beanId", async (req: Request<BeanParams>, res: Response<BeanResponse>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;

  const body = parseBody(updateBeanSchema, req, res);
  if (!body) return;

  // Scoped to the workspace, so a bean ID from another workspace updates nothing and 404s below.
  await db.update(beans).set(body).where(beanInWorkspace(req.params));
  const [bean] = await db.select().from(beans).where(beanInWorkspace(req.params));
  if (!bean) {
    sendError(res, 404, "Bean not found");
    return;
  }
  res.json({ bean });
});

// Deleting cascades to brew logs and their analyses, so a bean with history
// is only deleted when the client confirms with ?deleteBrewLogs=true.
beansRouter.delete("/:beanId", async (req: Request<BeanParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const confirmed = req.query.deleteBrewLogs === "true";

  const outcome = await db.transaction(async (tx) => {
    const [bean] = await tx
      .select({ id: beans.id })
      .from(beans)
      .where(beanInWorkspace(req.params))
      .for("update");
    if (!bean) return { status: "not_found" } as const;

    if (!confirmed) {
      const [{ brewLogCount } = { brewLogCount: 0 }] = await tx
        .select({ brewLogCount: count() })
        .from(brewLogs)
        .where(eq(brewLogs.beanId, bean.id));
      if (brewLogCount > 0) return { status: "has_logs", brewLogCount } as const;
    }

    await tx.delete(beans).where(eq(beans.id, bean.id));
    return { status: "deleted" } as const;
  });

  if (outcome.status === "not_found") {
    sendError(res, 404, "Bean not found");
    return;
  }
  if (outcome.status === "has_logs") {
    sendError(
      res,
      409,
      `This bean has ${outcome.brewLogCount} brew log(s) that would be permanently deleted. ` +
        "Retry with ?deleteBrewLogs=true to confirm, or hide the bean instead.",
      { brewLogCount: outcome.brewLogCount }
    );
    return;
  }
  res.status(204).end();
});
