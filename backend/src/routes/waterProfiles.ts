import { randomUUID } from "node:crypto";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { brewLogs, waterProfiles, type WaterProfile } from "@barista/shared/schema";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";

// docs/api/water-profiles.md §3c
export type WaterProfileSummary = Omit<WaterProfile, "workspaceId">;

interface WorkspaceParams {
  workspaceId: string;
}
interface WaterProfileParams extends WorkspaceParams {
  waterProfileId: string;
}

// mg/L (ppm); GH and KH as CaCO3.
const ppm = decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMax: true }).nullable().optional();
const profileFields = {
  name: z.string().trim().min(1).max(100),
  notes: optionalText(255),
  isDefault: z.boolean(),
  tdsPpm: ppm,
  generalHardnessPpm: ppm,
  alkalinityPpm: ppm,
  calciumPpm: ppm,
  magnesiumPpm: ppm,
  sodiumPpm: ppm,
  potassiumPpm: ppm,
  bicarbonatePpm: ppm,
  chloridePpm: ppm,
  sulfatePpm: ppm,
  ph: decimalSchema({ min: 0, max: 14, scale: 1 }).nullable().optional(),
};

const createSchema = z.object({ ...profileFields, isDefault: profileFields.isDefault.optional() });
const updateProfileSchema = updateSchema({ ...profileFields, archived: z.boolean() }).refine(
  (b) => !(b.isDefault === true && b.archived === true),
  "An archived profile can't be the default"
);

const summary = {
  id: waterProfiles.id,
  name: waterProfiles.name,
  notes: waterProfiles.notes,
  isDefault: waterProfiles.isDefault,
  tdsPpm: waterProfiles.tdsPpm,
  generalHardnessPpm: waterProfiles.generalHardnessPpm,
  alkalinityPpm: waterProfiles.alkalinityPpm,
  calciumPpm: waterProfiles.calciumPpm,
  magnesiumPpm: waterProfiles.magnesiumPpm,
  sodiumPpm: waterProfiles.sodiumPpm,
  potassiumPpm: waterProfiles.potassiumPpm,
  bicarbonatePpm: waterProfiles.bicarbonatePpm,
  chloridePpm: waterProfiles.chloridePpm,
  sulfatePpm: waterProfiles.sulfatePpm,
  ph: waterProfiles.ph,
  archivedAt: waterProfiles.archivedAt,
  createdAt: waterProfiles.createdAt,
};

function inWorkspace(p: WaterProfileParams) {
  return and(eq(waterProfiles.id, p.waterProfileId), eq(waterProfiles.workspaceId, p.workspaceId));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// One default per workspace: making this one the default clears the rest.
async function clearOtherDefaults(tx: Tx, workspaceId: string, keepId: string): Promise<void> {
  await tx
    .update(waterProfiles)
    .set({ isDefault: false })
    .where(and(eq(waterProfiles.workspaceId, workspaceId), ne(waterProfiles.id, keepId)));
}

const DUPLICATE = "A water profile with that name already exists";

// Mounted at /api/workspaces/:workspaceId/water-profiles
export const waterProfilesRouter = Router({ mergeParams: true });
waterProfilesRouter.use(requireAuth);

waterProfilesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ waterProfiles: WaterProfileSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(waterProfiles)
    .where(eq(waterProfiles.workspaceId, workspaceId))
    // Active first, then archived; each by name.
    .orderBy(sql`${waterProfiles.archivedAt} IS NOT NULL`, asc(waterProfiles.name));
  res.json({ waterProfiles: rows });
});

waterProfilesRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ waterProfile: WaterProfileSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(waterProfiles).values({ id, workspaceId, ...body });
      if (body.isDefault) await clearOtherDefaults(tx, workspaceId, id);
    });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, DUPLICATE);
      return;
    }
    throw err;
  }
  const [waterProfile] = await db.select(summary).from(waterProfiles).where(eq(waterProfiles.id, id));
  if (!waterProfile) throw new Error(`Water profile ${id} missing after insert`);
  res.status(201).json({ waterProfile });
});

waterProfilesRouter.patch("/:waterProfileId", async (req: Request<WaterProfileParams>, res: Response<{ waterProfile: WaterProfileSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateProfileSchema, req, res);
  if (!body) return;
  const { archived, ...fields } = body;

  let outcome: "ok" | "not_found" | "archived_default";
  try {
    outcome = await db.transaction(async (tx) => {
      const [current] = await tx.select({ archivedAt: waterProfiles.archivedAt }).from(waterProfiles).where(inWorkspace(req.params)).for("update");
      if (!current) return "not_found";
      // Still archived after this change (and not being restored): can't be the default.
      if (fields.isDefault === true && current.archivedAt !== null && archived !== false) return "archived_default";
      await tx
        .update(waterProfiles)
        .set({
          ...fields,
          // Keep the original archive date if it's already archived; a
          // archived profile stops being the default.
          ...(archived === true ? { archivedAt: sql`COALESCE(${waterProfiles.archivedAt}, NOW())`, isDefault: false } : {}),
          ...(archived === false ? { archivedAt: null } : {}),
        })
        .where(inWorkspace(req.params));
      if (fields.isDefault === true) await clearOtherDefaults(tx, workspaceId, req.params.waterProfileId);
      return "ok";
    });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, DUPLICATE);
      return;
    }
    throw err;
  }
  if (outcome === "not_found") {
    sendError(res, 404, "Water profile not found");
    return;
  }
  if (outcome === "archived_default") {
    sendError(res, 400, "An archived profile can't be the default. Restore it first.");
    return;
  }
  const [waterProfile] = await db.select(summary).from(waterProfiles).where(inWorkspace(req.params));
  if (!waterProfile) throw new Error(`Water profile ${req.params.waterProfileId} missing after update`);
  res.json({ waterProfile });
});

// Only unused profiles can be deleted; used ones are archived so history keeps them.
waterProfilesRouter.delete("/:waterProfileId", async (req: Request<WaterProfileParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const outcome = await db.transaction(async (tx) => {
    const [profile] = await tx.select({ id: waterProfiles.id }).from(waterProfiles).where(inWorkspace(req.params)).for("update");
    if (!profile) return { status: "not_found" } as const;
    const [{ brewLogCount } = { brewLogCount: 0 }] = await tx
      .select({ brewLogCount: count() })
      .from(brewLogs)
      .where(eq(brewLogs.waterProfileId, profile.id));
    if (brewLogCount > 0) return { status: "in_use", brewLogCount } as const;
    await tx.delete(waterProfiles).where(eq(waterProfiles.id, profile.id));
    return { status: "deleted" } as const;
  });

  if (outcome.status === "not_found") {
    sendError(res, 404, "Water profile not found");
    return;
  }
  if (outcome.status === "in_use") {
    sendError(res, 409, `${outcome.brewLogCount} brew(s) were made with this water. Archive it instead.`, {
      brewLogCount: outcome.brewLogCount,
    });
    return;
  }
  res.status(204).end();
});
