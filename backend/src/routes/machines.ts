import { randomUUID } from "node:crypto";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { brewLogs, machines, PREINFUSION_MODES, PROFILE_CONTROLS, type Machine } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api_spec.md §3c. Works like grinders (§3b): retire keeps history;
// delete only works for machines no brew used.
export type MachineSummary = Omit<Machine, "workspaceId" | "createdAt">;

interface WorkspaceParams {
  workspaceId: string;
}
interface MachineParams extends WorkspaceParams {
  machineId: string;
}

const machineFields = {
  name: z.string().trim().min(1).max(100),
  notes: optionalText(255),
  preinfusion: z.enum(PREINFUSION_MODES),
  flowControl: z.enum(PROFILE_CONTROLS),
  pressureControl: z.enum(PROFILE_CONTROLS),
};
const createSchema = z.object({
  ...machineFields,
  preinfusion: machineFields.preinfusion.default("none"),
  flowControl: machineFields.flowControl.default("none"),
  pressureControl: machineFields.pressureControl.default("none"),
});
const updateMachineSchema = updateSchema({ ...machineFields, retired: z.boolean() });

const summary = {
  id: machines.id,
  name: machines.name,
  notes: machines.notes,
  preinfusion: machines.preinfusion,
  flowControl: machines.flowControl,
  pressureControl: machines.pressureControl,
  retiredAt: machines.retiredAt,
};

function inWorkspace(p: MachineParams) {
  return and(eq(machines.id, p.machineId), eq(machines.workspaceId, p.workspaceId));
}

// Mounted at /api/workspaces/:workspaceId/machines
export const machinesRouter = Router({ mergeParams: true });
machinesRouter.use(requireAuth);

machinesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ machines: MachineSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(machines)
    .where(eq(machines.workspaceId, workspaceId))
    // Active first, then retired; each by name.
    .orderBy(sql`${machines.retiredAt} IS NOT NULL`, asc(machines.name));
  res.json({ machines: rows });
});

machinesRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ machine: MachineSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(machines).values({ id, workspaceId, ...body });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, "A machine with that name already exists");
      return;
    }
    throw err;
  }
  const [machine] = await db.select(summary).from(machines).where(eq(machines.id, id));
  if (!machine) throw new Error(`Machine ${id} missing after insert`);
  res.status(201).json({ machine });
});

machinesRouter.patch("/:machineId", async (req: Request<MachineParams>, res: Response<{ machine: MachineSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateMachineSchema, req, res);
  if (!body) return;
  const { retired, ...fields } = body;

  try {
    await db
      .update(machines)
      .set({
        ...fields,
        // Keep the original retirement date if it's already retired.
        ...(retired === true ? { retiredAt: sql`COALESCE(${machines.retiredAt}, NOW())` } : {}),
        ...(retired === false ? { retiredAt: null } : {}),
      })
      .where(inWorkspace(req.params));
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, "A machine with that name already exists");
      return;
    }
    throw err;
  }
  const [machine] = await db.select(summary).from(machines).where(inWorkspace(req.params));
  if (!machine) {
    sendError(res, 404, "Machine not found");
    return;
  }
  res.json({ machine });
});

machinesRouter.delete("/:machineId", async (req: Request<MachineParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const outcome = await db.transaction(async (tx) => {
    const [machine] = await tx.select({ id: machines.id }).from(machines).where(inWorkspace(req.params)).for("update");
    if (!machine) return { status: "not_found" } as const;
    const [{ brewLogCount } = { brewLogCount: 0 }] = await tx
      .select({ brewLogCount: count() })
      .from(brewLogs)
      .where(eq(brewLogs.machineId, machine.id));
    if (brewLogCount > 0) return { status: "in_use", brewLogCount } as const;
    await tx.delete(machines).where(eq(machines.id, machine.id));
    return { status: "deleted" } as const;
  });

  if (outcome.status === "not_found") {
    sendError(res, 404, "Machine not found");
    return;
  }
  if (outcome.status === "in_use") {
    sendError(res, 409, `${outcome.brewLogCount} brew(s) were made with this machine. Retire it instead.`, {
      brewLogCount: outcome.brewLogCount,
    });
    return;
  }
  res.status(204).end();
});
