import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, vesselUsage } from "../usage.js";
import { brewLogs, vessels, type Vessel } from "@barista/shared/schema";
import { decimalSchema, updateSchema } from "../validation.js";

// docs/api/vessels.md §3g
export type VesselSummary = Omit<Vessel, "workspaceId">;

interface WorkspaceParams {
  workspaceId: string;
}
interface VesselParams extends WorkspaceParams {
  vesselId: string;
}

const vesselFields = {
  name: z.string().trim().min(1).max(100),
  weightGrams: decimalSchema({ min: 0, max: 10000, scale: 2, exclusiveMin: true, exclusiveMax: true }),
};
const createSchema = z.object(vesselFields);
const updateVesselSchema = updateSchema({ ...vesselFields, archived: z.boolean() });

const summary = {
  id: vessels.id,
  name: vessels.name,
  weightGrams: vessels.weightGrams,
  archivedAt: vessels.archivedAt,
  createdAt: vessels.createdAt,
};

function inWorkspace(p: VesselParams) {
  return and(eq(vessels.id, p.vesselId), eq(vessels.workspaceId, p.workspaceId));
}

const DUPLICATE = "A vessel with that name already exists";

// Mounted at /api/workspaces/:workspaceId/vessels
export const vesselsRouter = Router({ mergeParams: true });
vesselsRouter.use(requireAuth);
addUsageRoute(vesselsRouter, "vesselId", "vessels", vesselUsage, "Vessel not found");

vesselsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ vessels: VesselSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(vessels)
    .where(eq(vessels.workspaceId, workspaceId))
    // Active first, then archived; each by name.
    .orderBy(sql`${vessels.archivedAt} IS NOT NULL`, asc(vessels.name));
  res.json({ vessels: rows });
});

vesselsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ vessel: VesselSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(vessels).values({ id, workspaceId, ...body });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, DUPLICATE);
      return;
    }
    throw err;
  }
  const [vessel] = await db.select(summary).from(vessels).where(eq(vessels.id, id));
  if (!vessel) throw new Error(`Vessel ${id} missing after insert`);
  res.status(201).json({ vessel });
});

vesselsRouter.patch("/:vesselId", async (req: Request<VesselParams>, res: Response<{ vessel: VesselSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateVesselSchema, req, res);
  if (!body) return;
  const { archived, ...fields } = body;
  try {
    await db
      .update(vessels)
      .set({
        ...fields,
        // Keep the original archive date if it's already archived.
        ...(archived === true ? { archivedAt: sql`COALESCE(${vessels.archivedAt}, NOW())` } : {}),
        ...(archived === false ? { archivedAt: null } : {}),
      })
      .where(inWorkspace(req.params));
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, DUPLICATE);
      return;
    }
    throw err;
  }
  const [vessel] = await db.select(summary).from(vessels).where(inWorkspace(req.params));
  if (!vessel) {
    sendError(res, 404, "Vessel not found");
    return;
  }
  res.json({ vessel });
});

// GET /usage says what deleting it would unlink (docs/api/README.md, "Deleting").
// Its brews keep their net yield and become weighed directly, so the weight
// goes with the vessel (the FK alone would leave it behind).
vesselsRouter.delete("/:vesselId", async (req: Request<VesselParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const deleted = await db.transaction(async (tx) => {
    const [vessel] = await tx.select({ id: vessels.id }).from(vessels).where(inWorkspace(req.params)).for("update");
    if (!vessel) return false;
    await tx.update(brewLogs).set({ vesselId: null, vesselWeightGrams: null }).where(eq(brewLogs.vesselId, vessel.id));
    await tx.delete(vessels).where(eq(vessels.id, vessel.id));
    return true;
  });
  if (!deleted) {
    sendError(res, 404, "Vessel not found");
    return;
  }
  res.status(204).end();
});
