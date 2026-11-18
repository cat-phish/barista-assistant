// The Insights rows (docs/api/stats.md §11): every brew in a window with what
// the client counts from, the workspace's beans and its lookups. The stats
// route sends them; the worker freezes Your Year in Coffee from the same rows
// (docs/api/recaps.md §11c), so both count what a browser would.
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, type SQL } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import * as schema from "./schema.js";
import {
  beanFreezes,
  beanPhotos,
  beanProcesses,
  beans,
  brewerMethods,
  brewers,
  brewLogFlavors,
  brewLogGuests,
  brewLogProblems,
  brewLogs,
  brewServings,
  brewLogTools,
  brewProblems,
  drinks,
  grinders,
  guests,
  prepTools,
  recipes,
  recipeStyles,
  type Bean,
  type BrewLog,
  type RecipeStyle,
} from "./schema.js";

type Database = MySql2Database<typeof schema>;

// Local dates "YYYY-MM-DD", inclusive; mine: only the caller's brews.
export interface StatsRowsQuery {
  from?: string;
  to?: string;
  beanId?: string;
  recipeId?: string;
  brewerId?: string;
  mine?: boolean;
}

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
  // Who it was for (brew-logs.md §6, "Who it's for"), and a cold brew batch's
  // servings by who drank them (brew-servings.md §6c), which decide its split
  // once it has any (§11, "How the client counts").
  forMe: boolean;
  guestIds: string[];
  unnamedGuests: number;
  servings: StatsServing[];
  flavors: string[]; // the flavors picked on the wheel, by label (backlog 65)
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
  | "decaf"
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

// One serving of a batch: a guest's (named or not) or whoever logged it's.
export interface StatsServing {
  guestId: string | null;
  forGuest: boolean;
  concentrateGrams: number;
}

// A brewer's latest measured brews (any bean, recipe or filter), for the
// grounds retention it's learned from, as the brew page does
// (docs/api/brewers.md §3, "Grounds retention").
export const BREWER_RETENTION_SAMPLE = 20;
export interface StatsMeasuredBrew {
  doseGrams: number;
  waterGrams: number;
  iceGrams: number | null;
  yieldGrams: number;
}

export interface StatsResponse {
  brews: StatsBrew[];
  beans: StatsBean[];
  lookups: {
    brewers: Array<Named & { methodId: string | null; groundsRetention: number | null; measured: StatsMeasuredBrew[] }>;
    methods: Named[];
    styles: Array<Named & { brewsLike: RecipeStyle }>;
    recipes: Array<Named & { expectedFinishMinSec: number | null; expectedFinishMaxSec: number | null; createdAt: Date }>; // createdAt: a recap's new recipes
    grinders: Named[];
    tools: Named[];
    problems: Named[];
    processes: Named[];
    drinks: Named[];
    guests: Named[]; // archived ones too
  };
}


// A brew's local date, as the CSV export works it out (UTC when the offset is unknown).
function localDate(at: Date, offsetMinutes: number | null): string {
  return new Date(at.getTime() + (offsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10);
}

// UTC-12 to UTC+14 (brew-logs.md §6): the widest a local date can stray from UTC.
const MAX_OFFSET_MS = 14 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function loadBrews(db: Database, workspaceId: string, callerId: string, q: StatsRowsQuery): Promise<StatsBrew[]> {
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
      styleId: brewLogs.styleId, // the style it was brewed as (brew-logs.md §6)
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
      forMe: brewLogs.forMe,
      unnamedGuests: brewLogs.unnamedGuests,
    })
    .from(brewLogs)
    .leftJoin(brewers, eq(brewLogs.brewerId, brewers.id))
    .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
    .leftJoin(recipeStyles, eq(brewLogs.styleId, recipeStyles.id))
    .leftJoin(drinks, eq(brewLogs.drinkId, drinks.id))
    .where(and(...conditions))
    .orderBy(asc(brewLogs.timestamp), asc(brewLogs.id));

  const inRange = rows.filter((r) => {
    const d = localDate(r.timestamp, r.utcOffsetMinutes);
    return (!q.from || d >= q.from) && (!q.to || d <= q.to);
  });
  const ids = inRange.map((r) => r.id);
  const [tools, problems, guestIds, servings, flavors] = await Promise.all([toolIdsFor(db, ids), problemIdsFor(db, ids), guestIdsFor(db, ids), servingsFor(db, ids), flavorsFor(db, ids)]);
  return inRange.map((r) => ({
    ...r,
    toolIds: tools.get(r.id) ?? [],
    problemIds: problems.get(r.id) ?? [],
    guestIds: guestIds.get(r.id) ?? [],
    servings: servings.get(r.id) ?? [],
    flavors: flavors.get(r.id) ?? [],
  }));
}

async function flavorsFor(db: Database, brewLogIds: string[]): Promise<Map<string, string[]>> {
  if (brewLogIds.length === 0) return new Map();
  const rows = await db
    .select({ brewLogId: brewLogFlavors.brewLogId, id: brewLogFlavors.label })
    .from(brewLogFlavors)
    .where(inArray(brewLogFlavors.brewLogId, brewLogIds));
  return groupIds(rows);
}

async function guestIdsFor(db: Database, brewLogIds: string[]): Promise<Map<string, string[]>> {
  if (brewLogIds.length === 0) return new Map();
  const rows = await db
    .select({ brewLogId: brewLogGuests.brewLogId, id: brewLogGuests.guestId })
    .from(brewLogGuests)
    .where(inArray(brewLogGuests.brewLogId, brewLogIds));
  return groupIds(rows);
}

async function servingsFor(db: Database, brewLogIds: string[]): Promise<Map<string, StatsServing[]>> {
  const byLog = new Map<string, StatsServing[]>();
  if (brewLogIds.length === 0) return byLog;
  const rows = await db
    .select({ brewLogId: brewServings.brewLogId, guestId: brewServings.guestId, forGuest: brewServings.forGuest, concentrateGrams: brewServings.concentrateGrams })
    .from(brewServings)
    .where(inArray(brewServings.brewLogId, brewLogIds))
    .orderBy(asc(brewServings.timestamp), asc(brewServings.createdAt), asc(brewServings.id));
  for (const { brewLogId, ...s } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), s]);
  return byLog;
}

function groupIds(rows: Array<{ brewLogId: string; id: string }>): Map<string, string[]> {
  const byLog = new Map<string, string[]>();
  for (const { brewLogId, id } of rows) byLog.set(brewLogId, [...(byLog.get(brewLogId) ?? []), id]);
  return byLog;
}

async function toolIdsFor(db: Database, brewLogIds: string[]): Promise<Map<string, string[]>> {
  if (brewLogIds.length === 0) return new Map();
  const rows = await db
    .select({ brewLogId: brewLogTools.brewLogId, id: brewLogTools.toolId })
    .from(brewLogTools)
    .where(inArray(brewLogTools.brewLogId, brewLogIds));
  return groupIds(rows);
}

async function problemIdsFor(db: Database, brewLogIds: string[]): Promise<Map<string, string[]>> {
  if (brewLogIds.length === 0) return new Map();
  const rows = await db
    .select({ brewLogId: brewLogProblems.brewLogId, id: brewLogProblems.problemId })
    .from(brewLogProblems)
    .where(inArray(brewLogProblems.brewLogId, brewLogIds));
  return groupIds(rows);
}

async function loadBeans(db: Database, workspaceId: string): Promise<StatsBean[]> {
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
      decaf: beans.decaf,
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

async function loadLookups(db: Database, workspaceId: string): Promise<StatsResponse["lookups"]> {
  const [brewerRows, methods, styles, recipeRows, grinderRows, tools, problems, processes, drinkRows, guestRows] = await Promise.all([
    db
      .select({ id: brewers.id, name: brewers.name, methodId: brewers.methodId, groundsRetention: brewers.groundsRetention })
      .from(brewers)
      .where(eq(brewers.workspaceId, workspaceId)),
    db.select({ id: brewerMethods.id, name: brewerMethods.name }).from(brewerMethods).where(eq(brewerMethods.workspaceId, workspaceId)).orderBy(asc(brewerMethods.position)),
    db
      .select({ id: recipeStyles.id, name: recipeStyles.name, brewsLike: recipeStyles.brewsLike })
      .from(recipeStyles)
      .where(eq(recipeStyles.workspaceId, workspaceId))
      .orderBy(asc(recipeStyles.position)),
    db
      .select({ id: recipes.id, name: recipes.name, expectedFinishMinSec: recipes.expectedFinishMinSec, expectedFinishMaxSec: recipes.expectedFinishMaxSec, createdAt: recipes.createdAt })
      .from(recipes)
      .where(eq(recipes.workspaceId, workspaceId)),
    db.select({ id: grinders.id, name: grinders.name }).from(grinders).where(eq(grinders.workspaceId, workspaceId)),
    db.select({ id: prepTools.id, name: prepTools.name }).from(prepTools).where(eq(prepTools.workspaceId, workspaceId)).orderBy(asc(prepTools.position)),
    db.select({ id: brewProblems.id, name: brewProblems.name }).from(brewProblems).where(eq(brewProblems.workspaceId, workspaceId)).orderBy(asc(brewProblems.position)),
    db.select({ id: beanProcesses.id, name: beanProcesses.name }).from(beanProcesses).where(eq(beanProcesses.workspaceId, workspaceId)).orderBy(asc(beanProcesses.position)),
    db.select({ id: drinks.id, name: drinks.name }).from(drinks).where(eq(drinks.workspaceId, workspaceId)),
    db.select({ id: guests.id, name: guests.name }).from(guests).where(eq(guests.workspaceId, workspaceId)).orderBy(asc(guests.name)),
  ]);
  const measured = await loadMeasured(db, workspaceId);
  const brewerList = brewerRows.map((b) => ({ ...b, measured: measured.get(b.id) ?? [] }));
  return { brewers: brewerList, methods, styles, recipes: recipeRows, grinders: grinderRows, tools, problems, processes, drinks: drinkRows, guests: guestRows };
}

// Each brewer's latest BREWER_RETENTION_SAMPLE brews with a water weight and a
// measured yield (so no shots, and no steeping batch), newest first.
async function loadMeasured(db: Database, workspaceId: string): Promise<Map<string, StatsMeasuredBrew[]>> {
  const rows = await db
    .select({
      brewerId: brewLogs.brewerId,
      doseGrams: brewLogs.actualDoseGrams,
      waterGrams: brewLogs.actualWaterGrams,
      iceGrams: brewLogs.actualIceGrams,
      yieldGrams: brewLogs.actualYieldGrams,
    })
    .from(brewLogs)
    .where(and(eq(brewLogs.workspaceId, workspaceId), isNotNull(brewLogs.brewerId), isNotNull(brewLogs.actualWaterGrams), isNotNull(brewLogs.actualYieldGrams), eq(brewLogs.steeping, false)))
    .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id));
  const out = new Map<string, StatsMeasuredBrew[]>();
  for (const r of rows) {
    if (r.brewerId === null || r.waterGrams === null || r.yieldGrams === null) continue;
    const list = out.get(r.brewerId) ?? [];
    if (list.length < BREWER_RETENTION_SAMPLE) list.push({ doseGrams: r.doseGrams, waterGrams: r.waterGrams, iceGrams: r.iceGrams, yieldGrams: r.yieldGrams });
    out.set(r.brewerId, list);
  }
  return out;
}

export async function loadStatsRows(db: Database, workspaceId: string, callerId: string, q: StatsRowsQuery): Promise<StatsResponse> {
  const [brewRows, beanRows, lookups] = await Promise.all([loadBrews(db, workspaceId, callerId, q), loadBeans(db, workspaceId), loadLookups(db, workspaceId)]);
  return { brews: brewRows, beans: beanRows, lookups };
}
