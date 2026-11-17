import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, guestUsage } from "../usage.js";
import { brewLogGuests, brewLogs, guests, type Guest } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api/guests.md §2d
export type GuestSummary = Omit<Guest, "workspaceId">;

interface WorkspaceParams {
  workspaceId: string;
}
interface GuestParams extends WorkspaceParams {
  guestId: string;
}

const guestFields = {
  name: z.string().trim().min(1).max(100),
  notes: optionalText(1000),
};
const createSchema = z.object(guestFields).strict();
const updateGuestSchema = updateSchema({ ...guestFields, archived: z.boolean() });

const summary = {
  id: guests.id,
  name: guests.name,
  notes: guests.notes,
  archivedAt: guests.archivedAt,
  createdAt: guests.createdAt,
};

function inWorkspace(p: GuestParams) {
  return and(eq(guests.id, p.guestId), eq(guests.workspaceId, p.workspaceId));
}

const DUPLICATE = "A guest with that name already exists";

// Mounted at /api/workspaces/:workspaceId/guests
export const guestsRouter = Router({ mergeParams: true });
guestsRouter.use(requireAuth);
addUsageRoute(guestsRouter, "guestId", "guests", guestUsage, "Guest not found");

guestsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ guests: GuestSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(guests)
    .where(eq(guests.workspaceId, workspaceId))
    // Active first, then archived; each by name.
    .orderBy(sql`${guests.archivedAt} IS NOT NULL`, asc(guests.name));
  res.json({ guests: rows });
});

guestsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ guest: GuestSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(guests).values({ id, workspaceId, ...body });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, DUPLICATE);
      return;
    }
    throw err;
  }
  const [guest] = await db.select(summary).from(guests).where(eq(guests.id, id));
  if (!guest) throw new Error(`Guest ${id} missing after insert`);
  res.status(201).json({ guest });
});

guestsRouter.patch("/:guestId", async (req: Request<GuestParams>, res: Response<{ guest: GuestSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateGuestSchema, req, res);
  if (!body) return;
  const { archived, ...fields } = body;
  try {
    await db
      .update(guests)
      .set({
        ...fields,
        // Keep the original archive date if it's already archived.
        ...(archived === true ? { archivedAt: sql`COALESCE(${guests.archivedAt}, NOW())` } : {}),
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
  const [guest] = await db.select(summary).from(guests).where(inWorkspace(req.params));
  if (!guest) {
    sendError(res, 404, "Guest not found");
    return;
  }
  res.json({ guest });
});

// GET /usage says what deleting it would affect (docs/api/README.md, "Deleting").
guestsRouter.delete("/:guestId", async (req: Request<GuestParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  // Their brews keep a drinker: each one counts them as unnamed instead, so
  // the split stays the same (docs/api/guests.md §2d).
  const found = await db.transaction(async (tx) => {
    const [guest] = await tx.select({ id: guests.id }).from(guests).where(inWorkspace(req.params)).for("update");
    if (!guest) return false;
    await tx
      .update(brewLogs)
      .set({ unnamedGuests: sql`${brewLogs.unnamedGuests} + 1` })
      .where(inArray(brewLogs.id, tx.select({ id: brewLogGuests.brewLogId }).from(brewLogGuests).where(eq(brewLogGuests.guestId, guest.id))));
    await tx.delete(guests).where(eq(guests.id, guest.id));
    return true;
  });
  if (!found) {
    sendError(res, 404, "Guest not found");
    return;
  }
  res.status(204).end();
});
