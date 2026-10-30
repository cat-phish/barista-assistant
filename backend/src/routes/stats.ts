import { and, asc, count, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, parseQuery } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  beanFreezes,
  beanPhotos,
  beanProcesses,
  beans,
  brewerMethods,
  brewers,
  brewLogProblems,
  brewLogs,
  brewLogTools,
  brewProblems,
  drinks,
  grinders,
  INSIGHT_TABS,
  MAX_INSIGHT_CHARTS,
  MAX_LAYOUT_IDS,
  prepTools,
  recipes,
  recipeStyles,
  workspaceMembers,
  type Bean,
  type BrewLog,
  type InsightChart,
  type InsightLayout,
  type RecipeStyle,
} from "@barista/shared/schema";

// docs/api/stats.md §11: compact rows for the Stats page; the client adds them up.
export interface StatsBrew {
  id: string;
  timestamp: Date;
  utcOffsetMinutes: number | null;
  userId: string | null;
  beanId: string;
  recipeId: string | null;
  brewerId: string | null;
  methodId: string | null;
  styleId: string | null;
  brewsLike: RecipeStyle | null;
  grinderId: string | null;
  drinkId: string | null;
  toolIds: string[];
  problemIds: string[];
  doseGrams: number;
  waterGrams: number | null;
  iceGrams: number | null;
  yieldGrams: number | null;
  servingSize: BrewLog["servingSize"];
  servingUnit: BrewLog["servingUnit"];
  drinkServingSize: BrewLog["servingSize"];
  drinkServingUnit: BrewLog["servingUnit"];
  dilutionRatio: number | null;
  timeSec: number;
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  grindSetting: number | null;
  tempC: number | null;
  tdsPercent: number | null;
  rating: number | null;
  drinkRating: number | null;
}

export type StatsBean = Pick<
  Bean,
  | "id"
  | "roasterName"
  | "beanName"
  | "batchNumber"
  | "country"
  | "originArea"
  | "altitudeMasl"
  | "processId"
  | "roastLevel"
  | "roastDate"
  | "varieties"
  | "species"
  | "priceAmount"
  | "priceCurrency"
  | "bagWeightGrams"
  | "inventoryWeightGrams"
  | "purchaseDate"
  | "createdAt"
  | "archivedAt"
> & { freezes: Array<{ frozenOn: string; thawedOn: string | null }>; photoCount: number };

interface Named {
  id: string;
  name: string;
}

export interface StatsResponse {
  brews: StatsBrew[];
  beans: StatsBean[];
  lookups: {
    brewers: Array<Named & { methodId: string | null }>;
    methods: Named[];
    styles: Array<Named & { brewsLike: RecipeStyle }>;
    recipes: Array<Named & { expectedFinishMinSec: number | null; expectedFinishMaxSec: number | null }>;
    grinders: Named[];
    tools: Named[];
    problems: Named[];
    processes: Named[];
    drinks: Named[];
  };
}

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

// A brew's local date, as the CSV export works it out (UTC when the offset is unknown).
function localDate(at: Date, offsetMinutes: number | null): string {
  return new Date(at.getTime() + (offsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10);
}

// UTC-12 to UTC+14 (brew-logs.md §6): the widest a local date can stray from UTC.
const MAX_OFFSET_MS = 14 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function loadBrews(workspaceId: string, callerId: string, q: z.infer<typeof querySchema>): Promise<StatsBrew[]> {
  const conditions: SQL[] = [eq(brewLogs.workspaceId, workspaceId), eq(brewLogs.steeping, false)];
  if (q.beanId) conditions.push(eq(brewLogs.beanId, q.beanId));
  if (q.recipeId) conditions.push(eq(brewLogs.recipeId, q.recipeId));
  if (q.brewerId) conditions.push(eq(brewLogs.brewerId, q.brewerId));
  if (q.mine) conditions.push(eq(brewLogs.userId, callerId));
  // A padded UTC window in SQL; the exact local-date check is below.
  if (q.from) conditions.push(gte(brewLogs.timestamp, new Date(Date.parse(q.from) - MAX_OFFSET_MS)));
  if (q.to) conditions.push(lt(brewLogs.timestamp, new Date(Date.parse(q.to) + DAY_MS + MAX_OFFSET_MS)));

  const rows = await db
    .select({
      id: brewLogs.id,
      timestamp: brewLogs.timestamp,
      utcOffsetMinutes: brewLogs.utcOffsetMinutes,
      userId: brewLogs.userId,
      beanId: brewLogs.beanId,
      recipeId: brewLogs.recipeId,
      brewerId: brewLogs.brewerId,
      methodId: brewers.methodId,
      styleId: recipeStyles.id,
      brewsLike: recipeStyles.brewsLike,
      grinderId: brewLogs.grinderId,
      drinkId: brewLogs.drinkId,
      doseGrams: brewLogs.actualDoseGrams,
      waterGrams: brewLogs.actualWaterGrams,
      iceGrams: brewLogs.actualIceGrams,
      yieldGrams: brewLogs.actualYieldGrams,
      servingSize: brewLogs.servingSize,
      servingUnit: brewLogs.servingUnit,
      drinkServingSize: drinks.servingSize,
      drinkServingUnit: drinks.servingUnit,
      dilutionRatio: brewLogs.dilutionRatio,
      timeSec: brewLogs.actualTimeSec,
      expectedFinishMinSec: brewLogs.expectedFinishMinSec,
      expectedFinishMaxSec: brewLogs.expectedFinishMaxSec,
      grindSetting: brewLogs.actualGrindSetting,
      tempC: brewLogs.actualTempC,
      tdsPercent: brewLogs.tdsPercent,
      rating: brewLogs.rating,
      drinkRating: brewLogs.drinkRating,
    })
    .from(brewLogs)
    .leftJoin(brewers, eq(brewLogs.brewerId, brewers.id))
    .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
    .leftJoin(recipeStyles, eq(recipes.styleId, recipeStyles.id))
    .leftJoin(drinks, eq(brewLogs.drinkId, drinks.id))
    .where(and(...conditions))
    .orderBy(asc(brewLogs.timestamp), asc(brewLogs.id));

  const inRange = rows.filter((r) => {
    const d = localDate(r.timestamp, r.utcOffsetMinutes);
    return (!q.from || d >= q.from) && (!q.to || d <= q.to);
  });
  const ids = inRange.map((r) => r.id);
  const [tools, problems] = await Promise.all([toolIdsFor(ids), problemIdsFor(ids)]);
  return inRange.map((r) => ({ ...r, toolIds: tools.get(r.id) ?? [], problemIds: problems.get(r.id) ?? [] }));
}

function groupIds(rows: Array<{ brewLogId: string; id: string }>): Map<string, string[]> {
  const byLog = new Map<string, string[]>();
  for (const { brewLogId, id } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), id]);
  return byLog;
}

async function toolIdsFor(brewLogIds: string[]): Promise<Map<string, string[]>> {
  if (brewLogIds.length === 0) return new Map();
  const rows = await db
    .select({ brewLogId: brewLogTools.brewLogId, id: brewLogTools.toolId })
    .from(brewLogTools)
    .where(inArray(brewLogTools.brewLogId, brewLogIds));
  return groupIds(rows);
}

async function problemIdsFor(brewLogIds: string[]): Promise<Map<string, string[]>> {
  if (brewLogIds.length === 0) return new Map();
  const rows = await db
    .select({ brewLogId: brewLogProblems.brewLogId, id: brewLogProblems.problemId })
    .from(brewLogProblems)
    .where(inArray(brewLogProblems.brewLogId, brewLogIds));
  return groupIds(rows);
}

async function loadBeans(workspaceId: string): Promise<StatsBean[]> {
  const rows = await db
    .select({
      id: beans.id,
      roasterName: beans.roasterName,
      beanName: beans.beanName,
      batchNumber: beans.batchNumber,
      country: beans.country,
      originArea: beans.originArea,
      altitudeMasl: beans.altitudeMasl,
      processId: beans.processId,
      roastLevel: beans.roastLevel,
      roastDate: beans.roastDate,
      varieties: beans.varieties,
      species: beans.species,
      priceAmount: beans.priceAmount,
      priceCurrency: beans.priceCurrency,
      bagWeightGrams: beans.bagWeightGrams,
      inventoryWeightGrams: beans.inventoryWeightGrams,
      purchaseDate: beans.purchaseDate,
      createdAt: beans.createdAt,
      archivedAt: beans.archivedAt,
    })
    .from(beans)
    .where(eq(beans.workspaceId, workspaceId))
    .orderBy(asc(beans.createdAt), asc(beans.id));
  const ids = rows.map((b) => b.id);
  if (ids.length === 0) return [];

  const [freezes, photos] = await Promise.all([
    db
      .select({ beanId: beanFreezes.beanId, frozenOn: beanFreezes.frozenOn, thawedOn: beanFreezes.thawedOn })
      .from(beanFreezes)
      .where(inArray(beanFreezes.beanId, ids))
      .orderBy(asc(beanFreezes.frozenOn), asc(beanFreezes.createdAt)),
    db
      .select({ beanId: beanPhotos.beanId, n: count() })
      .from(beanPhotos)
      .where(inArray(beanPhotos.beanId, ids))
      .groupBy(beanPhotos.beanId),
  ]);
  const freezesByBean = new Map<string, StatsBean["freezes"]>();
  for (const { beanId, ...f } of freezes) freezesByBean.set(beanId, [...(freezesByBean.get(beanId) ?? []), f]);
  const photosByBean = new Map(photos.map((p) => [p.beanId, Number(p.n)]));
  return rows.map((b) => ({ ...b, freezes: freezesByBean.get(b.id) ?? [], photoCount: photosByBean.get(b.id) ?? 0 }));
}

async function loadLookups(workspaceId: string): Promise<StatsResponse["lookups"]> {
  const [brewerRows, methods, styles, recipeRows, grinderRows, tools, problems, processes, drinkRows] = await Promise.all([
    db.select({ id: brewers.id, name: brewers.name, methodId: brewers.methodId }).from(brewers).where(eq(brewers.workspaceId, workspaceId)),
    db.select({ id: brewerMethods.id, name: brewerMethods.name }).from(brewerMethods).where(eq(brewerMethods.workspaceId, workspaceId)).orderBy(asc(brewerMethods.position)),
    db
      .select({ id: recipeStyles.id, name: recipeStyles.name, brewsLike: recipeStyles.brewsLike })
      .from(recipeStyles)
      .where(eq(recipeStyles.workspaceId, workspaceId))
      .orderBy(asc(recipeStyles.position)),
    db
      .select({ id: recipes.id, name: recipes.name, expectedFinishMinSec: recipes.expectedFinishMinSec, expectedFinishMaxSec: recipes.expectedFinishMaxSec })
      .from(recipes)
      .where(eq(recipes.workspaceId, workspaceId)),
    db.select({ id: grinders.id, name: grinders.name }).from(grinders).where(eq(grinders.workspaceId, workspaceId)),
    db.select({ id: prepTools.id, name: prepTools.name }).from(prepTools).where(eq(prepTools.workspaceId, workspaceId)).orderBy(asc(prepTools.position)),
    db.select({ id: brewProblems.id, name: brewProblems.name }).from(brewProblems).where(eq(brewProblems.workspaceId, workspaceId)).orderBy(asc(brewProblems.position)),
    db.select({ id: beanProcesses.id, name: beanProcesses.name }).from(beanProcesses).where(eq(beanProcesses.workspaceId, workspaceId)).orderBy(asc(beanProcesses.position)),
    db.select({ id: drinks.id, name: drinks.name }).from(drinks).where(eq(drinks.workspaceId, workspaceId)),
  ]);
  return { brewers: brewerRows, methods, styles, recipes: recipeRows, grinders: grinderRows, tools, problems, processes, drinks: drinkRows };
}

// Mounted at /api/workspaces/:workspaceId/stats
export const statsRouter = Router({ mergeParams: true });
statsRouter.use(requireAuth);

statsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<StatsResponse>) => {
  const { workspaceId } = req.params;
  const callerId = authedUserId(req);
  if (!(await requireMembership(res, callerId, workspaceId))) return;

  const query = parseQuery(querySchema, req, res);
  if (!query) return;

  const [brews, beanRows, lookups] = await Promise.all([loadBrews(workspaceId, callerId, query), loadBeans(workspaceId), loadLookups(workspaceId)]);
  res.json({ brews, beans: beanRows, lookups });
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
