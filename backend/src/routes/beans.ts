import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { beanFreezes, beans, brewLogs, ROAST_LEVELS, type Bean, type BeanFreeze } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

export type FreezePeriod = Pick<BeanFreeze, "id" | "frozenOn" | "thawedOn">;

// Every bean the API returns carries its freeze history (docs/api_spec.md §4).
export type BeanWithFreezes = Bean & { freezePeriods: FreezePeriod[] };

export interface BeanListResponse {
  beans: BeanWithFreezes[];
}

export interface BeanResponse {
  bean: BeanWithFreezes;
}

interface WorkspaceParams {
  workspaceId: string;
}

const beanFields = {
  roasterName: z.string().trim().min(1).max(255),
  beanName: z.string().trim().min(1).max(255),
  process: optionalText(100),
  roastLevel: z.enum(ROAST_LEVELS).nullable().optional(),
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

const freezeBodySchema = z.object({ date: z.iso.date().optional() }).strict();

// YYYY-MM-DD strings compare correctly as plain strings.
function serverToday(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function loadBeans(where: SQL | undefined): Promise<BeanWithFreezes[]> {
  const rows = await db.select().from(beans).where(where).orderBy(asc(beans.roasterName), asc(beans.beanName));
  if (rows.length === 0) return [];
  const periods = await db
    .select({ id: beanFreezes.id, beanId: beanFreezes.beanId, frozenOn: beanFreezes.frozenOn, thawedOn: beanFreezes.thawedOn })
    .from(beanFreezes)
    .where(inArray(beanFreezes.beanId, rows.map((b) => b.id)))
    .orderBy(asc(beanFreezes.frozenOn), asc(beanFreezes.createdAt));
  const byBean = new Map<string, FreezePeriod[]>();
  for (const { beanId, ...period } of periods) {
    byBean.set(beanId, [...(byBean.get(beanId) ?? []), period]);
  }
  return rows.map((bean) => ({ ...bean, freezePeriods: byBean.get(bean.id) ?? [] }));
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

  res.json({ beans: await loadBeans(eq(beans.workspaceId, workspaceId)) });
});

beansRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<BeanResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

  const body = parseBody(createBeanSchema, req, res);
  if (!body) return;

  const id = randomUUID();
  await db.insert(beans).values({ id, workspaceId, ...body });
  const [bean] = await loadBeans(eq(beans.id, id));
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
  const [bean] = await loadBeans(beanInWorkspace(req.params));
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

// Freeze/thaw (docs/api_spec.md §4). Both lock the bean row, so concurrent
// requests can't open two periods or thaw twice.
async function changeFreezeState(req: Request<BeanParams>, res: Response<BeanResponse>, action: "freeze" | "thaw"): Promise<void> {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(freezeBodySchema, req, res);
  if (!body) return;
  const date = body.date ?? serverToday();
  if (date > serverToday(1)) {
    sendError(res, 400, "date: can't be in the future");
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [bean] = await tx
      .select({ id: beans.id, roastDate: beans.roastDate })
      .from(beans)
      .where(beanInWorkspace(req.params))
      .for("update");
    if (!bean) return { status: 404, error: "Bean not found" } as const;

    const [open] = await tx
      .select({ id: beanFreezes.id, frozenOn: beanFreezes.frozenOn })
      .from(beanFreezes)
      .where(and(eq(beanFreezes.beanId, bean.id), isNull(beanFreezes.thawedOn)))
      .limit(1);

    if (action === "freeze") {
      if (open) return { status: 409, error: "This bean is already frozen" } as const;
      const roastDay = bean.roastDate?.toISOString().slice(0, 10);
      if (roastDay && date < roastDay) return { status: 400, error: `date: can't be before the roast date (${roastDay})` } as const;
      const [last] = await tx
        .select({ thawedOn: beanFreezes.thawedOn })
        .from(beanFreezes)
        .where(eq(beanFreezes.beanId, bean.id))
        .orderBy(desc(beanFreezes.thawedOn))
        .limit(1);
      if (last?.thawedOn && date < last.thawedOn) {
        return { status: 400, error: `date: can't be before the last thaw (${last.thawedOn})` } as const;
      }
      await tx.insert(beanFreezes).values({ id: randomUUID(), beanId: bean.id, frozenOn: date });
    } else {
      if (!open) return { status: 409, error: "This bean isn't frozen" } as const;
      if (date < open.frozenOn) return { status: 400, error: `date: can't be before it was frozen (${open.frozenOn})` } as const;
      await tx.update(beanFreezes).set({ thawedOn: date }).where(eq(beanFreezes.id, open.id));
    }
    return { status: 200 } as const;
  });

  if (outcome.status !== 200) {
    sendError(res, outcome.status, outcome.error);
    return;
  }
  const [bean] = await loadBeans(beanInWorkspace(req.params));
  if (!bean) {
    sendError(res, 404, "Bean not found");
    return;
  }
  res.json({ bean });
}

beansRouter.post("/:beanId/freeze", (req: Request<BeanParams>, res: Response<BeanResponse>) => changeFreezeState(req, res, "freeze"));
beansRouter.post("/:beanId/thaw", (req: Request<BeanParams>, res: Response<BeanResponse>) => changeFreezeState(req, res, "thaw"));
