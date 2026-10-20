import { randomUUID } from "node:crypto";
import { and, asc, count, eq, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { COMPONENT_TYPES, components, drinkComponents, type Component } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";

// docs/api_spec.md §5b: reusable preps that finish a drink.
export type ComponentSummary = Pick<Component, "id" | "name" | "componentType" | "instructions"> & { drinkCount: number };

interface WorkspaceParams {
  workspaceId: string;
}
interface ComponentParams extends WorkspaceParams {
  componentId: string;
}

const componentFields = {
  name: z.string().trim().min(1).max(100),
  componentType: z.enum(COMPONENT_TYPES),
  instructions: optionalText(5000),
};
const createSchema = z.object({ ...componentFields, componentType: componentFields.componentType.default("other") });
const updateComponentSchema = updateSchema(componentFields);

function inWorkspace(p: ComponentParams) {
  return and(eq(components.id, p.componentId), eq(components.workspaceId, p.workspaceId));
}

async function loadComponents(where: SQL | undefined): Promise<ComponentSummary[]> {
  const rows = await db
    .select({
      id: components.id,
      name: components.name,
      componentType: components.componentType,
      instructions: components.instructions,
      drinkCount: count(drinkComponents.id),
    })
    .from(components)
    .leftJoin(drinkComponents, eq(drinkComponents.componentId, components.id))
    .where(where)
    .groupBy(components.id)
    .orderBy(asc(components.name));
  return rows;
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A component with that name already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/components
export const componentsRouter = Router({ mergeParams: true });
componentsRouter.use(requireAuth);

componentsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ components: ComponentSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ components: await loadComponents(eq(components.workspaceId, workspaceId)) });
});

componentsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ component: ComponentSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(components).values({ id, workspaceId, ...body });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [component] = await loadComponents(eq(components.id, id));
  if (!component) throw new Error(`Component ${id} missing after insert`);
  res.status(201).json({ component });
});

componentsRouter.patch("/:componentId", async (req: Request<ComponentParams>, res: Response<{ component: ComponentSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateComponentSchema, req, res);
  if (!body) return;
  try {
    await db.update(components).set(body).where(inWorkspace(req.params));
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const [component] = await loadComponents(inWorkspace(req.params));
  if (!component) {
    sendError(res, 404, "Component not found");
    return;
  }
  res.json({ component });
});

// The FK cascades (so workspace deletion works); this check protects drinks.
componentsRouter.delete("/:componentId", async (req: Request<ComponentParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const outcome = await db.transaction(async (tx) => {
    const [component] = await tx.select({ id: components.id }).from(components).where(inWorkspace(req.params)).for("update");
    if (!component) return { status: "not_found" } as const;
    const [{ drinkCount } = { drinkCount: 0 }] = await tx
      .select({ drinkCount: count() })
      .from(drinkComponents)
      .where(eq(drinkComponents.componentId, component.id));
    if (drinkCount > 0) return { status: "in_use", drinkCount } as const;
    await tx.delete(components).where(eq(components.id, component.id));
    return { status: "deleted" } as const;
  });
  if (outcome.status === "not_found") {
    sendError(res, 404, "Component not found");
    return;
  }
  if (outcome.status === "in_use") {
    sendError(res, 409, `${outcome.drinkCount} drink(s) use this component. Remove it from them first.`, { drinkCount: outcome.drinkCount });
    return;
  }
  res.status(204).end();
});
