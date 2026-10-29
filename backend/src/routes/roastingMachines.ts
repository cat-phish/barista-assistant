import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, roastingMachineUsage } from "../usage.js";
import { roastingMachines, type RoastingMachine } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api/roasting-machines.md §3f
export type RoastingMachineSummary = Omit<RoastingMachine, "workspaceId">;

interface WorkspaceParams {
  workspaceId: string;
}
interface MachineParams extends WorkspaceParams {
  machineId: string;
}

const machineFields = {
  name: z.string().trim().min(1).max(100),
  notes: optionalText(255),
  capacityGrams: z.number().int().min(1).max(100_000).nullable().optional(),
};
const createSchema = z.object(machineFields);
const updateMachineSchema = updateSchema({ ...machineFields, archived: z.boolean() });

const summary = {
  id: roastingMachines.id,
  name: roastingMachines.name,
  notes: roastingMachines.notes,
  capacityGrams: roastingMachines.capacityGrams,
  archivedAt: roastingMachines.archivedAt,
  createdAt: roastingMachines.createdAt,
};

function inWorkspace(p: MachineParams) {
  return and(eq(roastingMachines.id, p.machineId), eq(roastingMachines.workspaceId, p.workspaceId));
}

const DUPLICATE = "A roasting machine with that name already exists";

// Mounted at /api/workspaces/:workspaceId/roasting-machines
export const roastingMachinesRouter = Router({ mergeParams: true });
roastingMachinesRouter.use(requireAuth);
addUsageRoute(roastingMachinesRouter, "machineId", "roastingMachines", roastingMachineUsage, "Roasting machine not found");

roastingMachinesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ machines: RoastingMachineSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(roastingMachines)
    .where(eq(roastingMachines.workspaceId, workspaceId))
    // Active first, then archived; each by name.
    .orderBy(sql`${roastingMachines.archivedAt} IS NOT NULL`, asc(roastingMachines.name));
  res.json({ machines: rows });
});

roastingMachinesRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ machine: RoastingMachineSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(roastingMachines).values({ id, workspaceId, ...body });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, DUPLICATE);
      return;
    }
    throw err;
  }
  const [machine] = await db.select(summary).from(roastingMachines).where(eq(roastingMachines.id, id));
  if (!machine) throw new Error(`Roasting machine ${id} missing after insert`);
  res.status(201).json({ machine });
});

roastingMachinesRouter.patch("/:machineId", async (req: Request<MachineParams>, res: Response<{ machine: RoastingMachineSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateMachineSchema, req, res);
  if (!body) return;
  const { archived, ...fields } = body;
  try {
    await db
      .update(roastingMachines)
      .set({
        ...fields,
        // Keep the original archive date if it's already archived.
        ...(archived === true ? { archivedAt: sql`COALESCE(${roastingMachines.archivedAt}, NOW())` } : {}),
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
  const [machine] = await db.select(summary).from(roastingMachines).where(inWorkspace(req.params));
  if (!machine) {
    sendError(res, 404, "Roasting machine not found");
    return;
  }
  res.json({ machine });
});

// GET /usage says what deleting it would unlink (docs/api/README.md, "Deleting").
roastingMachinesRouter.delete("/:machineId", async (req: Request<MachineParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(roastingMachines).where(inWorkspace(req.params));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Roasting machine not found");
    return;
  }
  res.status(204).end();
});
