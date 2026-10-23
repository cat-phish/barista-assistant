import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, parseQuery, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, grinderUsage } from "../usage.js";
import { BURR_TYPES, brewLogs, GRINDER_ADJUSTMENTS, GRINDER_POWER, grinders, type Grinder } from "@barista/shared/schema";
import { decimalSchema, grindSettingSchema, optionalText, updateSchema } from "../validation.js";

// docs/api/grinders.md §3b
export type GrinderSummary = Omit<Grinder, "workspaceId">;

export interface LastSettingResponse {
  lastSetting: { grindSetting: number; grindRpm: number | null; timestamp: Date; brewLogId: string } | null;
}

interface WorkspaceParams {
  workspaceId: string;
}
interface GrinderParams extends WorkspaceParams {
  grinderId: string;
}

const rpmSchema = z.number().int().min(50).max(5000).nullable().optional();
const settingSchema = grindSettingSchema.nullable().optional();
const grinderFields = {
  name: z.string().trim().min(1).max(100),
  notes: optionalText(255),
  adjustment: z.enum(GRINDER_ADJUSTMENTS).nullable().optional(),
  settingMin: settingSchema,
  settingMax: settingSchema,
  stepSize: decimalSchema({ min: 0, max: 1000, scale: 2, exclusiveMin: true, exclusiveMax: true }).nullable().optional(),
  burrType: z.enum(BURR_TYPES).nullable().optional(),
  burrSizeMm: z.number().int().min(10).max(200).nullable().optional(),
  power: z.enum(GRINDER_POWER).nullable().optional(),
  variableSpeed: z.boolean().optional(),
  rpmMin: rpmSchema,
  rpmMax: rpmSchema,
};

type RangeBody = { settingMin?: number | null; settingMax?: number | null; rpmMin?: number | null; rpmMax?: number | null; variableSpeed?: boolean };

// A range is a pair: both ends (min < max), or null on either clears both.
function pairIssue(min: number | null | undefined, max: number | null | undefined, keys: [string, string], ctx: z.RefinementCtx): void {
  if (min === undefined && max === undefined) return;
  if (min === null || max === null) return;
  if (min === undefined || max === undefined) {
    ctx.addIssue({ code: "custom", path: [min === undefined ? keys[0] : keys[1]], message: "send both ends of the range" });
  } else if (min >= max) {
    ctx.addIssue({ code: "custom", path: [keys[1]], message: `must be greater than ${keys[0]}` });
  }
}
function rangeIssue(body: RangeBody, ctx: z.RefinementCtx): void {
  pairIssue(body.settingMin, body.settingMax, ["settingMin", "settingMax"], ctx);
  pairIssue(body.rpmMin, body.rpmMax, ["rpmMin", "rpmMax"], ctx);
  if (body.variableSpeed === false && (body.rpmMin ?? null) !== null) {
    ctx.addIssue({ code: "custom", path: ["rpmMin"], message: "an RPM range is only for a variable-speed grinder" });
  }
}
// Clearing either end clears both; a grinder that isn't variable speed has no RPM range.
function clearRangeTogether<T extends RangeBody>(body: T): T {
  const out = { ...body };
  if (out.settingMin === null || out.settingMax === null) Object.assign(out, { settingMin: null, settingMax: null });
  if (out.rpmMin === null || out.rpmMax === null || out.variableSpeed === false) Object.assign(out, { rpmMin: null, rpmMax: null });
  return out;
}

const createSchema = z
  .object(grinderFields)
  .superRefine(rangeIssue)
  .refine((b) => (b.rpmMin ?? null) === null || b.variableSpeed === true, { path: ["rpmMin"], message: "an RPM range is only for a variable-speed grinder" })
  .transform(clearRangeTogether);
const updateGrinderSchema = updateSchema({ ...grinderFields, archived: z.boolean() }).superRefine(rangeIssue).transform(clearRangeTogether);
const lastSettingQuery = z.object({ recipeId: z.uuid() });

const summary = {
  id: grinders.id,
  name: grinders.name,
  notes: grinders.notes,
  adjustment: grinders.adjustment,
  settingMin: grinders.settingMin,
  settingMax: grinders.settingMax,
  stepSize: grinders.stepSize,
  burrType: grinders.burrType,
  burrSizeMm: grinders.burrSizeMm,
  power: grinders.power,
  variableSpeed: grinders.variableSpeed,
  rpmMin: grinders.rpmMin,
  rpmMax: grinders.rpmMax,
  archivedAt: grinders.archivedAt,
  createdAt: grinders.createdAt,
};

function inWorkspace(p: GrinderParams) {
  return and(eq(grinders.id, p.grinderId), eq(grinders.workspaceId, p.workspaceId));
}

// Mounted at /api/workspaces/:workspaceId/grinders
export const grindersRouter = Router({ mergeParams: true });
grindersRouter.use(requireAuth);
addUsageRoute(grindersRouter, "grinderId", "grinders", grinderUsage, "Grinder not found");

grindersRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ grinders: GrinderSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(grinders)
    .where(eq(grinders.workspaceId, workspaceId))
    // Active first, then archived; each by name.
    .orderBy(sql`${grinders.archivedAt} IS NOT NULL`, asc(grinders.name));
  res.json({ grinders: rows });
});

grindersRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ grinder: GrinderSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(grinders).values({ id, workspaceId, ...body });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, "A grinder with that name already exists");
      return;
    }
    throw err;
  }
  const [grinder] = await db.select(summary).from(grinders).where(eq(grinders.id, id));
  if (!grinder) throw new Error(`Grinder ${id} missing after insert`);
  res.status(201).json({ grinder });
});

grindersRouter.patch("/:grinderId", async (req: Request<GrinderParams>, res: Response<{ grinder: GrinderSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateGrinderSchema, req, res);
  if (!body) return;
  const { archived, ...fields } = body;

  // An RPM range on its own needs the grinder to already be variable speed.
  if ((fields.rpmMin ?? null) !== null && fields.variableSpeed === undefined) {
    const [current] = await db.select({ variableSpeed: grinders.variableSpeed }).from(grinders).where(inWorkspace(req.params));
    if (current && !current.variableSpeed) {
      sendError(res, 400, "rpmMin: an RPM range is only for a variable-speed grinder");
      return;
    }
  }

  try {
    await db
      .update(grinders)
      .set({
        ...fields,
        // Keep the original archive date if it's already archived.
        ...(archived === true ? { archivedAt: sql`COALESCE(${grinders.archivedAt}, NOW())` } : {}),
        ...(archived === false ? { archivedAt: null } : {}),
      })
      .where(inWorkspace(req.params));
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, "A grinder with that name already exists");
      return;
    }
    throw err;
  }
  const [grinder] = await db.select(summary).from(grinders).where(inWorkspace(req.params));
  if (!grinder) {
    sendError(res, 404, "Grinder not found");
    return;
  }
  res.json({ grinder });
});

// Deleting unlinks what used it; GET /usage says what, for the warning
// (docs/api/README.md, "Deleting"). Brews keep their record with the grinder unlinked; recipes lose their grind setting for it.
grindersRouter.delete("/:grinderId", async (req: Request<GrinderParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(grinders).where(inWorkspace(req.params));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Grinder not found");
    return;
  }
  res.status(204).end();
});

grindersRouter.get(
  "/:grinderId/last-setting",
  async (req: Request<GrinderParams>, res: Response<LastSettingResponse>) => {
    const { workspaceId, grinderId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
    const query = parseQuery(lastSettingQuery, req, res);
    if (!query) return;

    const [grinder] = await db.select({ id: grinders.id }).from(grinders).where(inWorkspace(req.params));
    if (!grinder) {
      sendError(res, 404, "Grinder not found");
      return;
    }
    const [last] = await db
      .select({ grindSetting: brewLogs.actualGrindSetting, grindRpm: brewLogs.grindRpm, timestamp: brewLogs.timestamp, brewLogId: brewLogs.id })
      .from(brewLogs)
      .where(
        and(
          eq(brewLogs.workspaceId, workspaceId),
          eq(brewLogs.grinderId, grinderId),
          eq(brewLogs.recipeId, query.recipeId),
          isNotNull(brewLogs.actualGrindSetting)
        )
      )
      .orderBy(desc(brewLogs.timestamp), desc(brewLogs.id))
      .limit(1);

    res.json({ lastSetting: last && last.grindSetting !== null ? { ...last, grindSetting: last.grindSetting } : null });
  }
);
