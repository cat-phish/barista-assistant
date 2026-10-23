import { randomUUID } from "node:crypto";
import { and, asc, count, eq, sql, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, brewerUsage } from "../usage.js";
import {
  brewers,
  brewLogs,
  METHOD_KINDS,
  PREINFUSION_MODES,
  PROFILE_CONTROLS,
  recipes,
  type Brewer,
} from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api/brewers.md §3: what makes the coffee (V60, AeroPress, an espresso
// machine). Espresso brewers record their capabilities; the menu fields put
// the plain brew on the public menu. Archived like grinders (§3b) once brews
// used one.
export type BrewerSummary = Omit<Brewer, "workspaceId">;

export interface BrewerListResponse {
  brewers: BrewerSummary[];
}

export interface BrewerResponse {
  brewer: BrewerSummary;
}

interface WorkspaceParams {
  workspaceId: string;
}
interface BrewerParams extends WorkspaceParams {
  brewerId: string;
}

const brewerFields = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(METHOD_KINDS), // the brew method, also how brewers are grouped
  notes: optionalText(255),
  preinfusion: z.enum(PREINFUSION_MODES),
  flowControl: z.enum(PROFILE_CONTROLS),
  pressureControl: z.enum(PROFILE_CONTROLS),
};

const createBrewerSchema = z.object({
  ...brewerFields,
  kind: brewerFields.kind.default("filter"),
  preinfusion: brewerFields.preinfusion.default("none"),
  flowControl: brewerFields.flowControl.default("none"),
  pressureControl: brewerFields.pressureControl.default("none"),
})
  // Brewers have no category or menu fields any more (the menu builder, §7b):
  // an old client sending them gets a 400 rather than a silent drop.
  .strict();

const updateBrewerSchema = updateSchema({ ...brewerFields, archived: z.boolean() });

const summary = {
  id: brewers.id,
  name: brewers.name,
  kind: brewers.kind,
  notes: brewers.notes,
  preinfusion: brewers.preinfusion,
  flowControl: brewers.flowControl,
  pressureControl: brewers.pressureControl,
  archivedAt: brewers.archivedAt,
  createdAt: brewers.createdAt,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function inWorkspace(p: BrewerParams): SQL | undefined {
  return and(eq(brewers.id, p.brewerId), eq(brewers.workspaceId, p.workspaceId));
}

// Recipes and brews use a brewer; drinks don't (they need a kind, not a device).
async function usage(tx: Tx, brewerId: string): Promise<{ recipeCount: number; brewLogCount: number }> {
  const [[r], [l]] = await Promise.all([
    tx.select({ n: count() }).from(recipes).where(eq(recipes.brewerId, brewerId)),
    tx.select({ n: count() }).from(brewLogs).where(eq(brewLogs.brewerId, brewerId)),
  ]);
  return { recipeCount: r?.n ?? 0, brewLogCount: l?.n ?? 0 };
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  // The unique index's collation is case-insensitive, so "v60" collides with "V60".
  sendError(res, 409, "A brewer with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/brewers
export const brewersRouter = Router({ mergeParams: true });
brewersRouter.use(requireAuth);
addUsageRoute(brewersRouter, "brewerId", "brewers", brewerUsage, "Brewer not found");

brewersRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<BrewerListResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(brewers)
    .where(eq(brewers.workspaceId, workspaceId))
    // Active first, then archived; each by name.
    .orderBy(sql`${brewers.archivedAt} IS NOT NULL`, asc(brewers.name));
  res.json({ brewers: rows });
});

brewersRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<BrewerResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createBrewerSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(brewers).values({ id, workspaceId, ...body });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [brewer] = await db.select(summary).from(brewers).where(eq(brewers.id, id));
  if (!brewer) throw new Error(`Brewer ${id} missing after insert`);
  res.status(201).json({ brewer });
});

// Recipes and brews reference brewers by ID, so a rename shows up everywhere
// at once. Case-only renames ("v60" -> "V60") are allowed: the unique index
// only compares against other rows. The kind can't change while recipes use
// the brewer, since recipe fields differ by kind (docs/api/brewers.md §3).
brewersRouter.patch("/:brewerId", async (req: Request<BrewerParams>, res: Response<BrewerResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateBrewerSchema, req, res);
  if (!body) return;
  const { archived, ...fields } = body;

  let outcome: { status: "not_found" } | { status: "in_use"; recipeCount: number } | { status: "updated" };
  try {
    outcome = await db.transaction(async (tx) => {
      // Locked so a recipe can't start using it between the count and the update.
      const [brewer] = await tx.select({ id: brewers.id, kind: brewers.kind }).from(brewers).where(inWorkspace(req.params)).for("update");
      if (!brewer) return { status: "not_found" } as const;
      if (fields.kind !== undefined && fields.kind !== brewer.kind) {
        const { recipeCount } = await usage(tx, brewer.id);
        if (recipeCount > 0) return { status: "in_use", recipeCount } as const;
      }
      await tx
        .update(brewers)
        .set({
          ...fields,
          // Keep the original archive date if it's already archived.
          ...(archived === true ? { archivedAt: sql`COALESCE(${brewers.archivedAt}, NOW())` } : {}),
          ...(archived === false ? { archivedAt: null } : {}),
        })
        .where(eq(brewers.id, brewer.id));
      return { status: "updated" } as const;
    });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }

  if (outcome.status === "not_found") {
    sendError(res, 404, "Brewer not found");
    return;
  }
  if (outcome.status === "in_use") {
    sendError(res, 409, `${outcome.recipeCount} recipe(s) use this brewer, so its kind can't change.`, { recipeCount: outcome.recipeCount });
    return;
  }
  const [brewer] = await db.select(summary).from(brewers).where(inWorkspace(req.params));
  if (!brewer) {
    sendError(res, 404, "Brewer not found");
    return;
  }
  res.json({ brewer });
});

// Deleting unlinks what used it; GET /usage says what, for the warning
// (docs/api/README.md, "Deleting"). Its recipes go with it (the FK cascades); brews keep their record, with the brewer and recipe unlinked; menu items that show it go.
brewersRouter.delete("/:brewerId", async (req: Request<BrewerParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(brewers).where(inWorkspace(req.params));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Brewer not found");
    return;
  }
  res.status(204).end();
});
