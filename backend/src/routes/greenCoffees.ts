import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, greenCoffeeUsage } from "../usage.js";
import { greenCoffees, ORIGIN_AREAS, type GreenCoffee } from "@barista/shared/schema";
import { optionalText, updateSchema } from "../validation.js";
import {
  PRICE_ERROR,
  PROCESS_ERROR,
  priceAmountSchema,
  priceCurrencySchema,
  priceMismatch,
  processInWorkspace,
  purchaseDateSchema,
  speciesSchema,
  varietiesSchema,
} from "./beans.js";

// docs/api/green-coffees.md §4e
export type GreenCoffeeSummary = Omit<GreenCoffee, "workspaceId">;

interface WorkspaceParams {
  workspaceId: string;
}
interface GreenParams extends WorkspaceParams {
  greenId: string;
}

const grams = z.number().int().min(0).max(1_000_000);
// The origin fields are a bean's (docs/api/beans.md §4), so a roast can copy them.
const greenFields = {
  name: z.string().trim().min(1).max(255),
  originArea: z.enum(ORIGIN_AREAS).nullable().optional(),
  country: optionalText(100),
  region: optionalText(255),
  producer: optionalText(255),
  altitudeMasl: z.number().int().min(0).max(9000).nullable().optional(),
  varieties: varietiesSchema,
  species: speciesSchema,
  processId: z.uuid().nullable().optional(),
  supplier: optionalText(255),
  lot: optionalText(100),
  priceAmount: priceAmountSchema,
  priceCurrency: priceCurrencySchema,
  weightBoughtGrams: grams.min(1).nullable().optional(),
  weightLeftGrams: grams,
  lowStockGrams: grams.min(1).nullable().optional(),
  purchaseDate: purchaseDateSchema,
  notes: optionalText(2000),
};
// Stock left starts at what was bought.
const createSchema = z
  .object({ ...greenFields, weightLeftGrams: grams.optional() })
  .transform(({ weightLeftGrams, ...body }) => ({ ...body, weightLeftGrams: weightLeftGrams ?? body.weightBoughtGrams ?? 0 }));
const updateGreenSchema = updateSchema({ ...greenFields, archived: z.boolean() });

const summary = {
  id: greenCoffees.id,
  name: greenCoffees.name,
  originArea: greenCoffees.originArea,
  country: greenCoffees.country,
  region: greenCoffees.region,
  producer: greenCoffees.producer,
  altitudeMasl: greenCoffees.altitudeMasl,
  varieties: greenCoffees.varieties,
  species: greenCoffees.species,
  processId: greenCoffees.processId,
  supplier: greenCoffees.supplier,
  lot: greenCoffees.lot,
  priceAmount: greenCoffees.priceAmount,
  priceCurrency: greenCoffees.priceCurrency,
  weightBoughtGrams: greenCoffees.weightBoughtGrams,
  weightLeftGrams: greenCoffees.weightLeftGrams,
  lowStockGrams: greenCoffees.lowStockGrams,
  purchaseDate: greenCoffees.purchaseDate,
  notes: greenCoffees.notes,
  archivedAt: greenCoffees.archivedAt,
  createdAt: greenCoffees.createdAt,
};

function inWorkspace(p: GreenParams) {
  return and(eq(greenCoffees.id, p.greenId), eq(greenCoffees.workspaceId, p.workspaceId));
}

const DUPLICATE = "A green coffee with that name already exists";

// Mounted at /api/workspaces/:workspaceId/green-coffees
export const greenCoffeesRouter = Router({ mergeParams: true });
greenCoffeesRouter.use(requireAuth);
addUsageRoute(greenCoffeesRouter, "greenId", "greenCoffees", greenCoffeeUsage, "Green coffee not found");

greenCoffeesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ greenCoffees: GreenCoffeeSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const rows = await db
    .select(summary)
    .from(greenCoffees)
    .where(eq(greenCoffees.workspaceId, workspaceId))
    // Active first, then archived; each by name.
    .orderBy(sql`${greenCoffees.archivedAt} IS NOT NULL`, asc(greenCoffees.name));
  res.json({ greenCoffees: rows });
});

greenCoffeesRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ greenCoffee: GreenCoffeeSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  if (priceMismatch(body.priceAmount, body.priceCurrency)) {
    sendError(res, 400, PRICE_ERROR);
    return;
  }
  if (!(await processInWorkspace(body.processId, workspaceId))) {
    sendError(res, 400, PROCESS_ERROR);
    return;
  }
  const id = randomUUID();
  try {
    await db.insert(greenCoffees).values({ id, workspaceId, ...body });
  } catch (err) {
    if (isDuplicateEntryError(err)) {
      sendError(res, 409, DUPLICATE);
      return;
    }
    throw err;
  }
  const [greenCoffee] = await db.select(summary).from(greenCoffees).where(eq(greenCoffees.id, id));
  if (!greenCoffee) throw new Error(`Green coffee ${id} missing after insert`);
  res.status(201).json({ greenCoffee });
});

greenCoffeesRouter.patch("/:greenId", async (req: Request<GreenParams>, res: Response<{ greenCoffee: GreenCoffeeSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateGreenSchema, req, res);
  if (!body) return;
  if (!(await processInWorkspace(body.processId, workspaceId))) {
    sendError(res, 400, PROCESS_ERROR);
    return;
  }
  const { archived, ...fields } = body;
  // The price rule is checked against the stored row with the change applied.
  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ priceAmount: greenCoffees.priceAmount, priceCurrency: greenCoffees.priceCurrency })
      .from(greenCoffees)
      .where(inWorkspace(req.params))
      .for("update");
    if (!existing) return "not_found" as const;
    const amount = fields.priceAmount === undefined ? existing.priceAmount : fields.priceAmount;
    const currency = fields.priceCurrency === undefined ? existing.priceCurrency : fields.priceCurrency;
    if (priceMismatch(amount, currency)) return "invalid" as const;
    await tx
      .update(greenCoffees)
      .set({
        ...fields,
        // Keep the original archive date if it's already archived.
        ...(archived === true ? { archivedAt: sql`COALESCE(${greenCoffees.archivedAt}, NOW())` } : {}),
        ...(archived === false ? { archivedAt: null } : {}),
      })
      .where(inWorkspace(req.params));
    return "updated" as const;
  }).catch((err: unknown) => {
    if (isDuplicateEntryError(err)) return "duplicate" as const;
    throw err;
  });
  if (outcome === "invalid") {
    sendError(res, 400, PRICE_ERROR);
    return;
  }
  if (outcome === "duplicate") {
    sendError(res, 409, DUPLICATE);
    return;
  }
  const [greenCoffee] = outcome === "updated" ? await db.select(summary).from(greenCoffees).where(inWorkspace(req.params)) : [];
  if (!greenCoffee) {
    sendError(res, 404, "Green coffee not found");
    return;
  }
  res.json({ greenCoffee });
});

// GET /usage says what deleting it would unlink (docs/api/README.md, "Deleting").
greenCoffeesRouter.delete("/:greenId", async (req: Request<GreenParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(greenCoffees).where(inWorkspace(req.params));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Green coffee not found");
    return;
  }
  res.status(204).end();
});
