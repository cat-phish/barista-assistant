import { randomUUID } from "node:crypto";
import { and, asc, count, eq, sql, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  brewers,
  brewLogs,
  drinkCategories,
  drinks,
  METHOD_KINDS,
  PREINFUSION_MODES,
  PROFILE_CONTROLS,
  recipes,
  type Brewer,
} from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api_spec.md §3: what makes the coffee (V60, AeroPress, an espresso
// machine). Espresso brewers record their capabilities; the menu fields put
// the plain brew on the public menu. Retired like grinders (§3b) once brews
// used one.
export type BrewerSummary = Omit<Brewer, "workspaceId" | "createdAt">;

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
  kind: z.enum(METHOD_KINDS),
  notes: optionalText(255),
  preinfusion: z.enum(PREINFUSION_MODES),
  flowControl: z.enum(PROFILE_CONTROLS),
  pressureControl: z.enum(PROFILE_CONTROLS),
  menuName: optionalText(100),
  description: optionalText(500),
  categoryId: z.uuid().nullable().optional(),
  showOnPublicMenu: z.boolean(),
};

const createBrewerSchema = z.object({
  ...brewerFields,
  kind: brewerFields.kind.default("pour_over"),
  preinfusion: brewerFields.preinfusion.default("none"),
  flowControl: brewerFields.flowControl.default("none"),
  pressureControl: brewerFields.pressureControl.default("none"),
  showOnPublicMenu: brewerFields.showOnPublicMenu.default(false),
});

const updateBrewerSchema = updateSchema({ ...brewerFields, retired: z.boolean() });

const summary = {
  id: brewers.id,
  name: brewers.name,
  kind: brewers.kind,
  notes: brewers.notes,
  preinfusion: brewers.preinfusion,
  flowControl: brewers.flowControl,
  pressureControl: brewers.pressureControl,
  menuName: brewers.menuName,
  description: brewers.description,
  categoryId: brewers.categoryId,
  showOnPublicMenu: brewers.showOnPublicMenu,
  retiredAt: brewers.retiredAt,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function inWorkspace(p: BrewerParams): SQL | undefined {
  return and(eq(brewers.id, p.brewerId), eq(brewers.workspaceId, p.workspaceId));
}

// Locked so a concurrent delete either finishes first (-> 400) or waits.
async function categoryInWorkspace(tx: Tx, categoryId: string | null | undefined, workspaceId: string): Promise<boolean> {
  if (!categoryId) return true;
  const found = await tx
    .select({ id: drinkCategories.id })
    .from(drinkCategories)
    .where(and(eq(drinkCategories.id, categoryId), eq(drinkCategories.workspaceId, workspaceId)))
    .for("update");
  return found.length === 1;
}

async function usage(tx: Tx, brewerId: string): Promise<{ recipeCount: number; drinkCount: number; brewLogCount: number }> {
  const [[r], [d], [l]] = await Promise.all([
    tx.select({ n: count() }).from(recipes).where(eq(recipes.brewerId, brewerId)),
    tx.select({ n: count() }).from(drinks).where(eq(drinks.brewerId, brewerId)),
    tx.select({ n: count() }).from(brewLogs).where(eq(brewLogs.brewerId, brewerId)),
  ]);
  return { recipeCount: r?.n ?? 0, drinkCount: d?.n ?? 0, brewLogCount: l?.n ?? 0 };
}

const BAD_CATEGORY = "categoryId: not a category in this workspace";
const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  // The unique index's collation is case-insensitive, so "v60" collides with "V60".
  sendError(res, 409, "A brewer with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/brewers
export const brewersRouter = Router({ mergeParams: true });
brewersRouter.use(requireAuth);

brewersRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<BrewerListResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(brewers)
    .where(eq(brewers.workspaceId, workspaceId))
    // Active first, then retired; each by name.
    .orderBy(sql`${brewers.retiredAt} IS NOT NULL`, asc(brewers.name));
  res.json({ brewers: rows });
});

brewersRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<BrewerResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createBrewerSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    const ok = await db.transaction(async (tx) => {
      if (!(await categoryInWorkspace(tx, body.categoryId, workspaceId))) return false;
      await tx.insert(brewers).values({ id, workspaceId, ...body });
      return true;
    });
    if (!ok) {
      sendError(res, 400, BAD_CATEGORY);
      return;
    }
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [brewer] = await db.select(summary).from(brewers).where(eq(brewers.id, id));
  if (!brewer) throw new Error(`Brewer ${id} missing after insert`);
  res.status(201).json({ brewer });
});

// Recipes and drinks reference brewers by ID, so a rename shows up everywhere
// at once. Case-only renames ("v60" -> "V60") are allowed: the unique index
// only compares against other rows. The kind can't change while recipes use
// the brewer, since recipe fields differ by kind (docs/api_spec.md §3).
brewersRouter.patch("/:brewerId", async (req: Request<BrewerParams>, res: Response<BrewerResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateBrewerSchema, req, res);
  if (!body) return;
  const { retired, ...fields } = body;

  let outcome: { status: "not_found" } | { status: "bad_category" } | { status: "in_use"; recipeCount: number } | { status: "updated" };
  try {
    outcome = await db.transaction(async (tx) => {
      // Locked so a recipe can't start using it between the count and the update.
      const [brewer] = await tx.select({ id: brewers.id, kind: brewers.kind }).from(brewers).where(inWorkspace(req.params)).for("update");
      if (!brewer) return { status: "not_found" } as const;
      if (fields.kind !== undefined && fields.kind !== brewer.kind) {
        const { recipeCount } = await usage(tx, brewer.id);
        if (recipeCount > 0) return { status: "in_use", recipeCount } as const;
      }
      if (!(await categoryInWorkspace(tx, fields.categoryId, workspaceId))) return { status: "bad_category" } as const;
      await tx
        .update(brewers)
        .set({
          ...fields,
          // Keep the original retirement date if it's already retired.
          ...(retired === true ? { retiredAt: sql`COALESCE(${brewers.retiredAt}, NOW())` } : {}),
          ...(retired === false ? { retiredAt: null } : {}),
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
  if (outcome.status === "bad_category") {
    sendError(res, 400, BAD_CATEGORY);
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

// The FK cascades to recipes and drinks (so workspace deletion works), which
// makes this check the only thing protecting them. Brewers that brews used
// are retired instead, so history keeps them.
brewersRouter.delete("/:brewerId", async (req: Request<BrewerParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const outcome = await db.transaction(async (tx) => {
    // Locked so a recipe or drink can't start using it between the count and the delete.
    const [brewer] = await tx.select({ id: brewers.id }).from(brewers).where(inWorkspace(req.params)).for("update");
    if (!brewer) return { status: "not_found" } as const;
    const counts = await usage(tx, brewer.id);
    if (counts.recipeCount > 0 || counts.drinkCount > 0 || counts.brewLogCount > 0) return { status: "in_use", ...counts } as const;
    await tx.delete(brewers).where(eq(brewers.id, brewer.id));
    return { status: "deleted" } as const;
  });

  if (outcome.status === "not_found") {
    sendError(res, 404, "Brewer not found");
    return;
  }
  if (outcome.status === "in_use") {
    const { recipeCount, drinkCount, brewLogCount } = outcome;
    const message =
      recipeCount > 0 || drinkCount > 0
        ? `${recipeCount} recipe(s) and ${drinkCount} drink(s) use this brewer. Change their brewer or delete them first.`
        : `${brewLogCount} brew(s) were made with this brewer. Retire it instead.`;
    sendError(res, 409, message, { recipeCount, drinkCount, brewLogCount });
    return;
  }
  res.status(204).end();
});
