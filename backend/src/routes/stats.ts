import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { loadStatsRows, type StatsResponse } from "@barista/shared/statsRows";
import { requireMembership } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, parseQuery } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { INSIGHT_TABS, MAX_INSIGHT_CHARTS, MAX_LAYOUT_IDS, workspaceMembers, type InsightChart, type InsightLayout } from "@barista/shared/schema";

// docs/api/stats.md §11: compact rows for the Stats page; the client adds them up.
interface WorkspaceParams {
  workspaceId: string;
}

const day = z.iso.date();
const querySchema = z
  .object({
    from: day.optional(),
    to: day.optional(),
    beanId: z.uuid().optional(),
    recipeId: z.uuid().optional(),
    brewerId: z.uuid().optional(),
    mine: z.literal("1").optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from: can't be after to", path: ["from"] });

// Mounted at /api/workspaces/:workspaceId/stats
export const statsRouter = Router({ mergeParams: true });
statsRouter.use(requireAuth);

statsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<StatsResponse>) => {
  const { workspaceId } = req.params;
  const callerId = authedUserId(req);
  if (!(await requireMembership(res, callerId, workspaceId))) return;

  const query = parseQuery(querySchema, req, res);
  if (!query) return;

  // The loader lives in @barista/shared/statsRows: the worker freezes Your Year in Coffee from the same rows.
  res.json(await loadStatsRows(db, workspaceId, callerId, { ...query, mine: query.mine === "1" }));
});

// docs/api/stats.md §11b: the caller's own added charts in this workspace.
// Field keys aren't checked against the Explore list (the client owns it and
// skips ones it doesn't know); they only have to look like keys.
const fieldKey = z.string().regex(/^[A-Za-z]{1,40}$/);
const chartSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.uuid(), kind: z.literal("explore"), tab: z.enum(INSIGHT_TABS), x: fieldKey, y: fieldKey, color: fieldKey.optional(), grinder: z.uuid().optional() }).strict(),
  z.object({ id: z.uuid(), kind: z.literal("chart"), tab: z.literal("overview"), chart: z.string().regex(/^[a-z]{1,20}\.[A-Za-z]{1,40}$/) }).strict(),
]);
const chartsBodySchema = z
  .object({
    charts: z
      .array(chartSchema)
      .max(MAX_INSIGHT_CHARTS)
      .refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length, "each id once")
      .refine((cs) => { const built = cs.filter((c) => c.kind === "chart").map((c) => c.chart); return new Set(built).size === built.length; }, "each chart once"),
  })
  .strict();

// A tab's order and hidden charts: built-in ids, or "pin:<id>" for an added
// chart (in the order only; an added chart is removed, not hidden).
const builtInId = z.string().regex(/^[a-z]{1,20}\.[A-Za-z]{1,40}$/);
const layoutId = z.union([builtInId, z.string().regex(/^pin:[0-9a-f-]{36}$/)]);
const idList = <T extends z.ZodType<string>>(id: T) =>
  z
    .array(id)
    .max(MAX_LAYOUT_IDS)
    .refine((ids) => new Set(ids).size === ids.length, "each id once");
const tabLayout = z.object({ order: idList(layoutId).optional(), hidden: idList(builtInId).optional(), tilesBelow: z.boolean().optional() }).strict();
const layoutBodySchema = z
  .object({ layout: z.partialRecord(z.enum(INSIGHT_TABS), tabLayout) })
  .strict();

const memberRow = (userId: string, workspaceId: string) => and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId));

statsRouter.get("/charts", async (req: Request<WorkspaceParams>, res: Response<{ charts: InsightChart[]; layout: InsightLayout }>) => {
  const { workspaceId } = req.params;
  const callerId = authedUserId(req);
  if (!(await requireMembership(res, callerId, workspaceId))) return;
  const [row] = await db
    .select({ charts: workspaceMembers.insightCharts, layout: workspaceMembers.insightLayout })
    .from(workspaceMembers)
    .where(memberRow(callerId, workspaceId))
    .limit(1);
  res.json({ charts: row?.charts ?? [], layout: row?.layout ?? {} });
});

// Replaces the list. Any member, viewers too: it's their own layout.
statsRouter.put("/charts", async (req: Request<WorkspaceParams>, res: Response<{ charts: InsightChart[] }>) => {
  const { workspaceId } = req.params;
  const callerId = authedUserId(req);
  if (!(await requireMembership(res, callerId, workspaceId))) return;
  const body = parseBody(chartsBodySchema, req, res);
  if (!body) return;
  const charts: InsightChart[] = body.charts;
  await db.update(workspaceMembers).set({ insightCharts: charts.length ? charts : null }).where(memberRow(callerId, workspaceId));
  res.json({ charts });
});

// Replaces the whole layout (every tab). Any member: it's their own.
statsRouter.put("/layout", async (req: Request<WorkspaceParams>, res: Response<{ layout: InsightLayout }>) => {
  const { workspaceId } = req.params;
  const callerId = authedUserId(req);
  if (!(await requireMembership(res, callerId, workspaceId))) return;
  const body = parseBody(layoutBodySchema, req, res);
  if (!body) return;
  const layout: InsightLayout = body.layout;
  await db.update(workspaceMembers).set({ insightLayout: Object.keys(layout).length ? layout : null }).where(memberRow(callerId, workspaceId));
  res.json({ layout });
});
