import { randomUUID } from "node:crypto";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  beans,
  DEFAULT_WORKSPACE_SETTINGS,
  DETAILED_ROAST_LEVELS,
  greenCoffees,
  MAX_REST_DAYS,
  ROAST_LEVELS,
  ROAST_TYPES,
  roastingMachines,
  roasts,
  withDefaults,
  workspaces,
  type GreenCoffee,
  type Roast,
} from "@barista/shared/schema";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { cancelRestReminder } from "../queue.js";
import { alertGreenLow, remindWhenRested, type ReminderOutcome } from "../reminders.js";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";
import { resolveRoastLevel } from "./beans.js";

// docs/api/roasts.md §4f
export type RoastSummary = Omit<Roast, "workspaceId"> & {
  greenCoffee: Pick<GreenCoffee, "id" | "name" | "weightLeftGrams" | "lowStockGrams"> | null;
  machine: { id: string; name: string } | null;
  bean: { id: string; inventoryWeightGrams: number; archived: boolean } | null;
};
// A saved roast, and its rest reminder when it's still resting (§1b).
interface SavedRoast {
  roast: RoastSummary;
  restReminder?: ReminderOutcome;
}

interface WorkspaceParams {
  workspaceId: string;
}
interface RoastParams extends WorkspaceParams {
  roastId: string;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const FUTURE_SKEW_MS = 5 * 60 * 1000; // as for brews
// What's checked against each other: the weights, and first crack inside the roast.
const MAX_WEIGHT_LOSS = 40; // %, a bean's roastWeightLossPercent limit
const grams = z.number().int().min(1).max(100_000);
const temp = decimalSchema({ min: 0, max: 350, scale: 1 }).nullable().optional();
const seconds = z.number().int().min(1).max(5999).nullable().optional(); // under 100 minutes
const roastFields = {
  greenCoffeeId: z.uuid(),
  machineId: z.uuid().nullable().optional(),
  roastedAt: z.iso
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .refine((d) => d.getTime() <= Date.now() + FUTURE_SKEW_MS, "can't be more than 5 minutes in the future"),
  utcOffsetMinutes: z.number().int().min(-720).max(840).nullable().optional(),
  batchNumber: optionalText(50),
  greenGrams: grams,
  roastedGrams: grams,
  roastType: z.enum(ROAST_TYPES).nullable().optional(),
  detailedRoastLevel: z.enum(DETAILED_ROAST_LEVELS).nullable().optional(),
  roastLevel: z.enum(ROAST_LEVELS).nullable().optional(),
  chargeTempC: temp,
  dropTempC: temp,
  firstCrackSec: seconds,
  totalSec: seconds,
  restDays: z.number().int().min(0).max(MAX_REST_DAYS),
  notes: optionalText(2000),
};
const createSchema = z.object({
  ...roastFields,
  roastedAt: roastFields.roastedAt.optional(),
  restDays: roastFields.restDays.optional(),
});
const updateRoastSchema = updateSchema(roastFields);

type Checked = Pick<Roast, "greenGrams" | "roastedGrams" | "firstCrackSec" | "totalSec">;
// The roast with the change applied: an error, or null when it hangs together.
function roastIssue(r: Checked): string | null {
  if (r.roastedGrams >= r.greenGrams) return "roastedGrams: must be less than greenGrams";
  if (weightLoss(r) > MAX_WEIGHT_LOSS) return `roastedGrams: more than ${MAX_WEIGHT_LOSS}% lost; check the weights`;
  if (r.firstCrackSec !== null && r.totalSec !== null && r.firstCrackSec >= r.totalSec) return "firstCrackSec: must be before the end of the roast (totalSec)";
  return null;
}
// % of the green weight lost, 1 decimal, as beans store it.
const weightLoss = (r: Pick<Roast, "greenGrams" | "roastedGrams">) => Math.round(((r.greenGrams - r.roastedGrams) / r.greenGrams) * 1000) / 10;

// The local roast date at UTC midnight: how a bean's roastDate is stored
// from a date (docs/api/beans.md §4). UTC when the offset is unknown.
function roastDay(at: Date, offsetMinutes: number | null): Date {
  return new Date(`${new Date(at.getTime() + (offsetMinutes ?? 0) * 60_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

// What the bean takes from its green coffee: the coffee itself, and a share
// of the purchase price for this batch's green weight.
function fromGreen(g: GreenCoffee, greenGrams: number) {
  const price = g.priceAmount !== null && g.priceCurrency !== null && g.weightBoughtGrams ? Math.round((g.priceAmount / g.weightBoughtGrams) * greenGrams * 100) / 100 : null;
  return {
    beanName: g.name,
    processId: g.processId,
    originArea: g.originArea,
    country: g.country,
    region: g.region,
    producer: g.producer,
    altitudeMasl: g.altitudeMasl,
    varieties: g.varieties,
    species: g.species,
    greenSupplier: g.supplier,
    priceAmount: price && price > 0 ? price : null,
    priceCurrency: price && price > 0 ? g.priceCurrency : null,
  };
}
// What the bean takes from the roast itself.
function fromRoast(r: Pick<Roast, "roastedAt" | "utcOffsetMinutes" | "roastType" | "detailedRoastLevel" | "roastLevel" | "greenGrams" | "roastedGrams" | "batchNumber">) {
  return {
    roastDate: roastDay(r.roastedAt, r.utcOffsetMinutes),
    roastType: r.roastType,
    detailedRoastLevel: r.detailedRoastLevel,
    roastLevel: r.roastLevel,
    roastWeightLossPercent: weightLoss(r),
    bagWeightGrams: r.roastedGrams,
    batchNumber: r.batchNumber,
  };
}

async function lockGreen(tx: Tx, id: string, workspaceId: string): Promise<GreenCoffee | undefined> {
  const [row] = await tx.select().from(greenCoffees).where(and(eq(greenCoffees.id, id), eq(greenCoffees.workspaceId, workspaceId))).for("update");
  return row;
}
// Takes up to `wanted` grams off a (locked) green coffee's stock; how much it took.
async function takeStock(tx: Tx, green: GreenCoffee, wanted: number): Promise<number> {
  const taken = Math.min(wanted, Math.max(0, green.weightLeftGrams));
  if (taken > 0) await tx.update(greenCoffees).set({ weightLeftGrams: sql`${greenCoffees.weightLeftGrams} - ${taken}` }).where(eq(greenCoffees.id, green.id));
  return taken;
}
// Whether taking stock moved a green coffee from at or above its threshold to below it.
const wentLow = (lowStockGrams: number | null, before: number, after: number) => lowStockGrams !== null && after < lowStockGrams && before >= lowStockGrams;
async function returnStock(tx: Tx, greenId: string | null, grams: number): Promise<void> {
  if (greenId && grams > 0) await tx.update(greenCoffees).set({ weightLeftGrams: sql`${greenCoffees.weightLeftGrams} + ${grams}` }).where(eq(greenCoffees.id, greenId));
}

// The next batch of a green coffee: one more than its highest numbered roast.
async function nextBatch(tx: Tx, greenId: string): Promise<string> {
  const rows = await tx.select({ batch: roasts.batchNumber }).from(roasts).where(eq(roasts.greenCoffeeId, greenId));
  const numbers = rows.map((r) => (r.batch && /^\d+$/.test(r.batch) ? Number(r.batch) : 0));
  return String(Math.max(0, ...numbers) + 1);
}

async function machineInWorkspace(tx: Tx, machineId: string | null | undefined, workspaceId: string): Promise<boolean> {
  if (!machineId) return true;
  const [row] = await tx.select({ id: roastingMachines.id }).from(roastingMachines).where(and(eq(roastingMachines.id, machineId), eq(roastingMachines.workspaceId, workspaceId)));
  return !!row;
}

async function settingsOf(tx: Tx, workspaceId: string) {
  const [row] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return withDefaults(DEFAULT_WORKSPACE_SETTINGS, row?.settings ?? null);
}

async function loadRoasts(where: SQL | undefined): Promise<RoastSummary[]> {
  const rows = await db
    .select({
      roast: roasts,
      green: { name: greenCoffees.name, weightLeftGrams: greenCoffees.weightLeftGrams, lowStockGrams: greenCoffees.lowStockGrams },
      machineName: roastingMachines.name,
      bean: { inventoryWeightGrams: beans.inventoryWeightGrams, archivedAt: beans.archivedAt },
    })
    .from(roasts)
    .leftJoin(greenCoffees, eq(roasts.greenCoffeeId, greenCoffees.id))
    .leftJoin(roastingMachines, eq(roasts.machineId, roastingMachines.id))
    .leftJoin(beans, eq(roasts.beanId, beans.id))
    .where(where)
    .orderBy(desc(roasts.roastedAt), desc(roasts.createdAt));
  return rows.map(({ roast: { workspaceId: _ws, ...r }, green, machineName, bean }) => ({
    ...r,
    greenCoffee: r.greenCoffeeId && green ? { id: r.greenCoffeeId, ...green } : null,
    machine: r.machineId && machineName !== null ? { id: r.machineId, name: machineName } : null,
    bean: r.beanId && bean ? { id: r.beanId, inventoryWeightGrams: bean.inventoryWeightGrams, archived: bean.archivedAt !== null } : null,
  }));
}
const inWorkspace = (p: RoastParams) => and(eq(roasts.id, p.roastId), eq(roasts.workspaceId, p.workspaceId));

type Outcome = { status: "ok"; id: string; lowGreenId: string | null; restChanged: boolean } | { status: "not_found" } | { status: "invalid"; error: string };
const invalid = (error: string): Outcome => ({ status: "invalid", error });

function send(res: Response, outcome: Exclude<Outcome, { status: "ok" }>): void {
  if (outcome.status === "not_found") sendError(res, 404, "Roast not found");
  else sendError(res, 400, outcome.error);
}

// After a save (docs/api/notifications.md §1b): the rest reminder, for whoever
// logged the roast, when its ready day may have moved; and a low-stock notice
// for whoever saved it, when it took the green coffee below its threshold.
async function afterSave(userId: string, roast: RoastSummary, outcome: Extract<Outcome, { status: "ok" }>): Promise<SavedRoast> {
  if (outcome.lowGreenId) await alertGreenLow(userId, outcome.lowGreenId);
  const restReminder = outcome.restChanged ? await remindWhenRested(roast.userId, roast) : undefined;
  return { roast, ...(restReminder ? { restReminder } : {}) };
}

// Mounted at /api/workspaces/:workspaceId/roasts
export const roastsRouter = Router({ mergeParams: true });
roastsRouter.use(requireAuth);

roastsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ roasts: RoastSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ roasts: await loadRoasts(eq(roasts.workspaceId, workspaceId)) });
});

roastsRouter.get("/:roastId", async (req: Request<RoastParams>, res: Response<{ roast: RoastSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId))) return;
  const [roast] = await loadRoasts(inWorkspace(req.params));
  if (!roast) {
    sendError(res, 404, "Roast not found");
    return;
  }
  res.json({ roast });
});

// Saving a roast creates its bean and takes its green weight off the stock.
roastsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<SavedRoast>) => {
  const { workspaceId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const level = resolveRoastLevel(body, null);
  if ("error" in level) {
    sendError(res, 400, level.error);
    return;
  }
  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const green = await lockGreen(tx, body.greenCoffeeId, workspaceId);
    if (!green) return invalid("greenCoffeeId: not a green coffee of this workspace");
    if (!(await machineInWorkspace(tx, body.machineId, workspaceId))) return invalid("machineId: not a roasting machine of this workspace");
    const settings = await settingsOf(tx, workspaceId);
    const roast = {
      ...body,
      machineId: body.machineId ?? null,
      roastedAt: body.roastedAt ?? new Date(),
      utcOffsetMinutes: body.utcOffsetMinutes ?? null,
      batchNumber: body.batchNumber === undefined ? await nextBatch(tx, green.id) : body.batchNumber,
      roastType: body.roastType ?? null,
      detailedRoastLevel: body.detailedRoastLevel ?? null,
      roastLevel: level.roastLevel ?? null,
      chargeTempC: body.chargeTempC ?? null,
      dropTempC: body.dropTempC ?? null,
      firstCrackSec: body.firstCrackSec ?? null,
      totalSec: body.totalSec ?? null,
      // An unknown roast type rests like an omni roast.
      restDays: body.restDays ?? settings.restDays[body.roastType ?? "omni"],
      notes: body.notes ?? null,
    };
    const issue = roastIssue(roast);
    if (issue) return invalid(issue);

    const beanId = randomUUID();
    await tx.insert(beans).values({
      id: beanId,
      workspaceId,
      roasterName: settings.homeRoasterName,
      ...fromGreen(green, roast.greenGrams),
      ...fromRoast(roast),
      inventoryWeightGrams: roast.roastedGrams,
    });
    const id = randomUUID();
    const greenStockTakenGrams = await takeStock(tx, green, roast.greenGrams);
    await tx.insert(roasts).values({ id, workspaceId, userId, beanId, greenStockTakenGrams, ...roast });
    const low = wentLow(green.lowStockGrams, green.weightLeftGrams, green.weightLeftGrams - greenStockTakenGrams);
    return { status: "ok", id, lowGreenId: low ? green.id : null, restChanged: true };
  });
  if (outcome.status !== "ok") {
    send(res, outcome);
    return;
  }
  const [roast] = await loadRoasts(eq(roasts.id, outcome.id));
  if (!roast) throw new Error(`Roast ${outcome.id} missing after insert`);
  res.status(201).json(await afterSave(userId, roast, outcome));
});

// The bean follows the roast: its roast details, and its coffee when the
// green coffee changes. Its stock moves by the change in roasted weight.
roastsRouter.patch("/:roastId", async (req: Request<RoastParams>, res: Response<SavedRoast>) => {
  const { workspaceId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateRoastSchema, req, res);
  if (!body) return;
  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [old] = await tx.select().from(roasts).where(inWorkspace(req.params)).for("update");
    if (!old) return { status: "not_found" };
    const level = resolveRoastLevel(body, old.detailedRoastLevel);
    if ("error" in level) return invalid(level.error);
    if (!(await machineInWorkspace(tx, body.machineId, workspaceId))) return invalid("machineId: not a roasting machine of this workspace");
    const next = { ...old, ...body, roastLevel: level.roastLevel === undefined ? old.roastLevel : level.roastLevel };
    const issue = roastIssue(next);
    if (issue) return invalid(issue);

    // Another green coffee, or another green weight: give back what was
    // taken, then take it again.
    const greenChanged = body.greenCoffeeId !== undefined && body.greenCoffeeId !== old.greenCoffeeId;
    let green: GreenCoffee | undefined;
    let taken = old.greenStockTakenGrams;
    let low = false;
    if (greenChanged || next.greenGrams !== old.greenGrams) {
      if (next.greenCoffeeId) {
        green = await lockGreen(tx, next.greenCoffeeId, workspaceId);
        if (!green) return invalid("greenCoffeeId: not a green coffee of this workspace");
      }
      const before = green?.weightLeftGrams ?? 0; // its stock before this edit
      await returnStock(tx, old.greenCoffeeId, old.greenStockTakenGrams);
      if (green) green = await lockGreen(tx, green.id, workspaceId); // with what was given back
      taken = green ? await takeStock(tx, green, next.greenGrams) : 0;
      if (green) low = wentLow(green.lowStockGrams, before, green.weightLeftGrams - taken);
    }
    const { id: _id, workspaceId: _ws, createdAt: _c, ...fields } = next;
    await tx.update(roasts).set({ ...fields, greenStockTakenGrams: taken }).where(eq(roasts.id, old.id));

    if (old.beanId) {
      const coffee = greenChanged && green ? fromGreen(green, next.greenGrams) : {};
      // The price follows the green weight even when the coffee doesn't change.
      if (!greenChanged && next.greenGrams !== old.greenGrams && green) {
        const { priceAmount, priceCurrency } = fromGreen(green, next.greenGrams);
        Object.assign(coffee, { priceAmount, priceCurrency });
      }
      const delta = next.roastedGrams - old.roastedGrams;
      await tx
        .update(beans)
        .set({
          ...coffee,
          ...fromRoast(next),
          ...(delta !== 0 ? { inventoryWeightGrams: sql`GREATEST(0, ${beans.inventoryWeightGrams} + ${delta})` } : {}),
        })
        .where(eq(beans.id, old.beanId));
    }
    const restChanged = next.roastedAt.getTime() !== old.roastedAt.getTime() || next.utcOffsetMinutes !== old.utcOffsetMinutes || next.restDays !== old.restDays;
    return { status: "ok", id: old.id, lowGreenId: low && green ? green.id : null, restChanged };
  });
  if (outcome.status !== "ok") {
    send(res, outcome);
    return;
  }
  const [roast] = await loadRoasts(eq(roasts.id, outcome.id));
  if (!roast) throw new Error(`Roast ${outcome.id} missing after update`);
  res.json(await afterSave(userId, roast, outcome));
});

// Gives back the green weight it took. Its bean stays, with its brews.
roastsRouter.delete("/:roastId", async (req: Request<RoastParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const found = await db.transaction(async (tx) => {
    const [old] = await tx.select().from(roasts).where(inWorkspace(req.params)).for("update");
    if (!old) return false;
    await returnStock(tx, old.greenCoffeeId, old.greenStockTakenGrams);
    await tx.delete(roasts).where(eq(roasts.id, old.id));
    return true;
  });
  if (!found) {
    sendError(res, 404, "Roast not found");
    return;
  }
  await cancelRestReminder(req.params.roastId).catch(() => undefined); // the worker skips deleted roasts anyway
  res.status(204).end();
});
