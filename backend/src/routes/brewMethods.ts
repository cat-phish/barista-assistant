import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { brewMethods, METHOD_KINDS, recipes, type BrewMethod } from "@barista/shared/schema";
import { updateSchema } from "../validation.js";

type BrewMethodSummary = Pick<BrewMethod, "id" | "name" | "kind">;

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
};

const createBrewMethodSchema = z.object({
  ...brewMethodFields,
  kind: brewMethodFields.kind.default("pour_over"),
});

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
      .select({ id: brewMethods.id, name: brewMethods.name, kind: brewMethods.kind })
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

    const brewMethod = { id: randomUUID(), name: body.name, kind: body.kind };
    try {
      // The unique index's collation is case-insensitive, so "v60" collides with "V60".
      await db.insert(brewMethods).values({ ...brewMethod, workspaceId });
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
      | { status: "in_use"; recipeCount: number }
      | { status: "updated"; brewMethod: BrewMethodSummary };
    try {
      outcome = await db.transaction(async (tx) => {
        // Locked so a recipe can't start using it between the count and the update.
        const [method] = await tx
          .select({ id: brewMethods.id, name: brewMethods.name, kind: brewMethods.kind })
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
    if (outcome.status === "in_use") {
      sendError(res, 409, `${outcome.recipeCount} recipe(s) use this brew method, so its kind can't change.`, {
        recipeCount: outcome.recipeCount,
      });
      return;
    }
    res.json({ brewMethod: outcome.brewMethod });
  }
);

// The FK cascades to recipes (so workspace deletion works), which makes this
// check the only thing protecting recipes from losing their method.
brewMethodsRouter.delete(
  "/:methodId",
  async (req: Request<WorkspaceParams & { methodId: string }>, res: Response) => {
    const { workspaceId, methodId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

    const outcome = await db.transaction(async (tx) => {
      // Lock the method so a recipe can't start using it between the count and the delete.
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
      if (recipeCount > 0) return { status: "in_use", recipeCount } as const;

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
        `${outcome.recipeCount} recipe(s) use this brew method. Change their method or delete them first.`,
        { recipeCount: outcome.recipeCount }
      );
      return;
    }
    res.status(204).end();
  }
);
