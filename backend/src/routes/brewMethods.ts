import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { brewMethods, drinkCategories, drinks, METHOD_KINDS, recipes, type BrewMethod } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api_spec.md §3; the menu fields put the plain brew on the public menu.
type BrewMethodSummary = Pick<BrewMethod, "id" | "name" | "kind" | "description" | "categoryId" | "showOnPublicMenu">;

export interface BrewMethodListResponse {
  brewMethods: BrewMethodSummary[];
}

export interface BrewMethodResponse {
  brewMethod: BrewMethodSummary;
}

interface WorkspaceParams {
  workspaceId: string;
}

const brewMethodFields = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(METHOD_KINDS),
  description: optionalText(500),
  categoryId: z.uuid().nullable().optional(),
  showOnPublicMenu: z.boolean(),
};

const createBrewMethodSchema = z.object({
  ...brewMethodFields,
  kind: brewMethodFields.kind.default("pour_over"),
  showOnPublicMenu: brewMethodFields.showOnPublicMenu.default(false),
});

const summary = {
  id: brewMethods.id,
  name: brewMethods.name,
  kind: brewMethods.kind,
  description: brewMethods.description,
  categoryId: brewMethods.categoryId,
  showOnPublicMenu: brewMethods.showOnPublicMenu,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

const BAD_CATEGORY = "categoryId: not a category in this workspace";

const updateBrewMethodSchema = updateSchema(brewMethodFields);

// Mounted at /api/workspaces/:workspaceId/brew-methods
export const brewMethodsRouter = Router({ mergeParams: true });
brewMethodsRouter.use(requireAuth);

brewMethodsRouter.get(
  "/",
  async (req: Request<WorkspaceParams>, res: Response<BrewMethodListResponse>) => {
    const { workspaceId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;

    const rows = await db
      .select(summary)
      .from(brewMethods)
      .where(eq(brewMethods.workspaceId, workspaceId))
      .orderBy(asc(brewMethods.name));

    res.json({ brewMethods: rows });
  }
);

brewMethodsRouter.post(
  "/",
  async (req: Request<WorkspaceParams>, res: Response<BrewMethodResponse>) => {
    const { workspaceId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

    const body = parseBody(createBrewMethodSchema, req, res);
    if (!body) return;

    const brewMethod: BrewMethodSummary = {
      id: randomUUID(),
      name: body.name,
      kind: body.kind,
      description: body.description ?? null,
      categoryId: body.categoryId ?? null,
      showOnPublicMenu: body.showOnPublicMenu,
    };
    try {
      const ok = await db.transaction(async (tx) => {
        if (!(await categoryInWorkspace(tx, brewMethod.categoryId, workspaceId))) return false;
        // The unique index's collation is case-insensitive, so "v60" collides with "V60".
        await tx.insert(brewMethods).values({ ...brewMethod, workspaceId });
        return true;
      });
      if (!ok) {
        sendError(res, 400, BAD_CATEGORY);
        return;
      }
    } catch (err) {
      if (isDuplicateEntryError(err)) {
        sendError(res, 409, "A brew method with that name already exists");
        return;
      }
      throw err;
    }

    res.status(201).json({ brewMethod });
  }
);

// Recipes reference methods by ID, so a rename shows up everywhere at once.
// Case-only renames ("v60" -> "V60") are allowed: the unique index only
// compares against other rows. The kind can't change while recipes use the
// method, since recipe fields differ by kind (docs/api_spec.md §3).
brewMethodsRouter.patch(
  "/:methodId",
  async (req: Request<WorkspaceParams & { methodId: string }>, res: Response<BrewMethodResponse>) => {
    const { workspaceId, methodId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

    const body = parseBody(updateBrewMethodSchema, req, res);
    if (!body) return;

    let outcome:
      | { status: "not_found" }
      | { status: "bad_category" }
      | { status: "in_use"; recipeCount: number }
      | { status: "updated"; brewMethod: BrewMethodSummary };
    try {
      outcome = await db.transaction(async (tx) => {
        // Locked so a recipe can't start using it between the count and the update.
        const [method] = await tx
          .select(summary)
          .from(brewMethods)
          .where(and(eq(brewMethods.id, methodId), eq(brewMethods.workspaceId, workspaceId)))
          .for("update");
        if (!method) return { status: "not_found" } as const;
        if (body.kind !== undefined && body.kind !== method.kind) {
          const [{ recipeCount } = { recipeCount: 0 }] = await tx
            .select({ recipeCount: count() })
            .from(recipes)
            .where(eq(recipes.methodId, methodId));
          if (recipeCount > 0) return { status: "in_use", recipeCount } as const;
        }
        if (!(await categoryInWorkspace(tx, body.categoryId, workspaceId))) return { status: "bad_category" } as const;
        await tx.update(brewMethods).set(body).where(eq(brewMethods.id, methodId));
        return { status: "updated", brewMethod: { ...method, ...body } } as const;
      });
    } catch (err) {
      if (isDuplicateEntryError(err)) {
        sendError(res, 409, "A brew method with that name already exists");
        return;
      }
      throw err;
    }

    if (outcome.status === "not_found") {
      sendError(res, 404, "Brew method not found");
      return;
    }
    if (outcome.status === "bad_category") {
      sendError(res, 400, BAD_CATEGORY);
      return;
    }
    if (outcome.status === "in_use") {
      sendError(res, 409, `${outcome.recipeCount} recipe(s) use this brew method, so its kind can't change.`, {
        recipeCount: outcome.recipeCount,
      });
      return;
    }
    res.json({ brewMethod: outcome.brewMethod });
  }
);

// The FK cascades to recipes and drinks (so workspace deletion works), which
// makes this check the only thing protecting them from losing their method.
brewMethodsRouter.delete(
  "/:methodId",
  async (req: Request<WorkspaceParams & { methodId: string }>, res: Response) => {
    const { workspaceId, methodId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

    const outcome = await db.transaction(async (tx) => {
      // Lock the method so a recipe or drink can't start using it between the count and the delete.
      const [method] = await tx
        .select({ id: brewMethods.id })
        .from(brewMethods)
        .where(and(eq(brewMethods.id, methodId), eq(brewMethods.workspaceId, workspaceId)))
        .for("update");
      if (!method) return { status: "not_found" } as const;

      const [{ recipeCount } = { recipeCount: 0 }] = await tx
        .select({ recipeCount: count() })
        .from(recipes)
        .where(eq(recipes.methodId, methodId));
      const [{ drinkCount } = { drinkCount: 0 }] = await tx
        .select({ drinkCount: count() })
        .from(drinks)
        .where(eq(drinks.methodId, methodId));
      if (recipeCount > 0 || drinkCount > 0) return { status: "in_use", recipeCount, drinkCount } as const;

      await tx.delete(brewMethods).where(eq(brewMethods.id, methodId));
      return { status: "deleted" } as const;
    });

    if (outcome.status === "not_found") {
      sendError(res, 404, "Brew method not found");
      return;
    }
    if (outcome.status === "in_use") {
      sendError(
        res,
        409,
        `${outcome.recipeCount} recipe(s) and ${outcome.drinkCount} drink(s) use this brew method. Change their method or delete them first.`,
        { recipeCount: outcome.recipeCount, drinkCount: outcome.drinkCount }
      );
      return;
    }
    res.status(204).end();
  }
);
