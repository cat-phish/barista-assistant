import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  beanFreezes,
  beanPhotos,
  beanProcesses,
  beans,
  BLEND_TYPES,
  brewLogs,
  COFFEE_SPECIES,
  DETAILED_ROAST_LEVELS,
  DETAILED_ROAST_TO_LEVEL,
  ORIGIN_AREAS,
  ROAST_LEVELS,
  ROAST_TYPES,
  type Bean,
  type BeanFreeze,
  type DetailedRoastLevel,
  type RoastLevel,
} from "@barista/shared/schema";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";
import { removePhotoFiles } from "../photos.js";
import type { PhotoInfo } from "./beanPhotos.js";

export type FreezePeriod = Pick<BeanFreeze, "id" | "frozenOn" | "thawedOn">;

// Every bean the API returns carries its freeze history (docs/api/beans.md §4).
// frozen: whether a period is still open (frozen now), worked out from the
// history so the two can't disagree.
// photos: cover first (docs/api/bean-photos.md §4c).
export type BeanWithFreezes = Bean & { freezePeriods: FreezePeriod[]; frozen: boolean; photos: PhotoInfo[] };

export interface BeanListResponse {
  beans: BeanWithFreezes[];
}

export interface BeanResponse {
  bean: BeanWithFreezes;
}

interface WorkspaceParams {
  workspaceId: string;
}

// Lists (docs/api/beans.md §4): each entry once, ignoring case; [] is
// stored as null. Shared with green coffees (docs/api/green-coffees.md §4e).
export const varietiesSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(20)
  .nullable()
  .transform((list) => {
    const out = new Map<string, string>();
    for (const v of list ?? []) if (!out.has(v.toLowerCase())) out.set(v.toLowerCase(), v);
    return out.size ? [...out.values()] : null;
  })
  .optional();
export const speciesSchema = z
  .array(z.enum(COFFEE_SPECIES))
  .nullable()
  .transform((list) => {
    const out = COFFEE_SPECIES.filter((s) => list?.includes(s));
    return out.length ? out : null;
  })
  .optional();
export const priceAmountSchema = decimalSchema({ min: 0, max: 1_000_000, scale: 2, exclusiveMin: true, exclusiveMax: true }).nullable().optional();
export const priceCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "must be a 3-letter currency code, e.g. USD")
  .nullable()
  .optional();
// Allows a day ahead for time zones, like freeze dates.
export const purchaseDateSchema = z.iso
  .date()
  .refine((d) => d <= serverToday(1), "can't be in the future")
  .nullable()
  .optional();

const beanFields = {
  roasterName: z.string().trim().min(1).max(255),
  beanName: z.string().trim().min(1).max(255),
  processId: z.uuid().nullable().optional(), // one of the workspace's processes (§4b)
  roastLevel: z.enum(ROAST_LEVELS).nullable().optional(),
  roastDate: z
    .union([z.iso.date(), z.iso.datetime()])
    .nullable()
    .transform((s) => (s ? new Date(s) : null))
    .optional(),
  inventoryWeightGrams: z.number().int().min(0).max(1_000_000),
  showOnPublicMenu: z.boolean(),
  roastType: z.enum(ROAST_TYPES).nullable().optional(),
  detailedRoastLevel: z.enum(DETAILED_ROAST_LEVELS).nullable().optional(),
  blendType: z.enum(BLEND_TYPES).nullable().optional(),
  decaf: z.boolean(),
  varieties: varietiesSchema,
  species: speciesSchema,
  // Shown as a link, so only http(s): no javascript: or data: URLs.
  website: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((s) => (s ? s : null))
    .refine((s) => s === null || isHttpUrl(s), "must be an http or https URL")
    .optional(),
  priceAmount: priceAmountSchema,
  priceCurrency: priceCurrencySchema,
  bagWeightGrams: z.number().int().min(1).max(100_000).nullable().optional(),
  // % of the green weight lost in roasting (docs/api/beans.md §4).
  roastWeightLossPercent: decimalSchema({ min: 0, max: 40, scale: 1, exclusiveMin: true }).nullable().optional(),
  notes: optionalText(2000),
  flavorProfile: optionalText(500),
  originArea: z.enum(ORIGIN_AREAS).nullable().optional(),
  country: optionalText(100),
  region: optionalText(255),
  altitudeMasl: z.number().int().min(0).max(9000).nullable().optional(),
  producer: optionalText(255),
  purchaseDate: purchaseDateSchema,
  greenSupplier: optionalText(255),
  // Which roast of this bean, for home roasters (docs/api/beans.md §4).
  batchNumber: optionalText(50),
  rating: z.number().int().min(1).max(5).nullable().optional(),
};

function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const createBeanSchema = z.object({
  ...beanFields,
  inventoryWeightGrams: beanFields.inventoryWeightGrams.default(0),
  showOnPublicMenu: beanFields.showOnPublicMenu.default(true),
  decaf: beanFields.decaf.default(false),
});

// A price needs its amount and currency, or neither.
export const PRICE_ERROR = "priceAmount: priceAmount and priceCurrency go together";
export const priceMismatch = (amount: number | null | undefined, currency: string | null | undefined) =>
  (amount ?? null) === null !== ((currency ?? null) === null);

// archived: true archives the bean (keeping the first date), false restores it.
const updateBeanSchema = updateSchema({ ...beanFields, archived: z.boolean() });

// roastLevel follows detailedRoastLevel (docs/api/beans.md §4): a detailed
// level sets it, clearing a stored detailed level clears it, and it can only
// be set on its own while the bean has no detailed level. Returns the roastLevel to
// store (undefined = unchanged), or an error.
export function resolveRoastLevel(
  body: { detailedRoastLevel?: DetailedRoastLevel | null; roastLevel?: RoastLevel | null },
  storedDetailed: DetailedRoastLevel | null,
): { roastLevel: RoastLevel | null | undefined } | { error: string } {
  const detailed = body.detailedRoastLevel === undefined ? storedDetailed : body.detailedRoastLevel;
  if (detailed === null) {
    // Clearing a stored detailed level clears the level it set, unless one is
    // sent. A null for a bean that never had one leaves roastLevel alone.
    if (body.detailedRoastLevel === null && storedDetailed !== null) return { roastLevel: body.roastLevel ?? null };
    return { roastLevel: body.roastLevel };
  }
  const derived = DETAILED_ROAST_TO_LEVEL[detailed];
  if (body.roastLevel !== undefined && body.roastLevel !== derived) {
    return { error: `roastLevel: set by detailedRoastLevel (${detailed} is ${derived})` };
  }
  return { roastLevel: body.detailedRoastLevel === undefined ? body.roastLevel : derived };
}

interface BeanParams extends WorkspaceParams {
  beanId: string;
}

const freezeBodySchema = z.object({ date: z.iso.date().optional() }).strict();

// YYYY-MM-DD strings compare correctly as plain strings.
function serverToday(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function loadBeans(where: SQL | undefined): Promise<BeanWithFreezes[]> {
  const rows = await db.select().from(beans).where(where).orderBy(asc(beans.roasterName), asc(beans.beanName));
  if (rows.length === 0) return [];
  const ids = rows.map((b) => b.id);
  const [periods, photoRows] = await Promise.all([
    db
      .select({ id: beanFreezes.id, beanId: beanFreezes.beanId, frozenOn: beanFreezes.frozenOn, thawedOn: beanFreezes.thawedOn })
      .from(beanFreezes)
      .where(inArray(beanFreezes.beanId, ids))
      .orderBy(asc(beanFreezes.frozenOn), asc(beanFreezes.createdAt)),
    db
      .select({ id: beanPhotos.id, beanId: beanPhotos.beanId, width: beanPhotos.width, height: beanPhotos.height })
      .from(beanPhotos)
      .where(inArray(beanPhotos.beanId, ids))
      .orderBy(asc(beanPhotos.position), asc(beanPhotos.createdAt)),
  ]);
  const byBean = new Map<string, FreezePeriod[]>();
  for (const { beanId, ...period } of periods) {
    byBean.set(beanId, [...(byBean.get(beanId) ?? []), period]);
  }
  const photosByBean = new Map<string, PhotoInfo[]>();
  for (const { beanId, ...photo } of photoRows) {
    photosByBean.set(beanId, [...(photosByBean.get(beanId) ?? []), photo]);
  }
  return rows.map((bean) => {
    const freezePeriods = byBean.get(bean.id) ?? [];
    return { ...bean, freezePeriods, frozen: freezePeriods.some((p) => p.thawedOn === null), photos: photosByBean.get(bean.id) ?? [] };
  });
}

function beanInWorkspace(params: BeanParams) {
  return and(eq(beans.id, params.beanId), eq(beans.workspaceId, params.workspaceId));
}

// Mounted at /api/workspaces/:workspaceId/beans
export const beansRouter = Router({ mergeParams: true });
beansRouter.use(requireAuth);

beansRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<BeanListResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;

  res.json({ beans: await loadBeans(eq(beans.workspaceId, workspaceId)) });
});

export const PROCESS_ERROR = "processId: not a process of this workspace";
// processId must be one of the workspace's own processes (hidden ones too,
// so a bean keeps its process when edited); null or absent is fine.
export async function processInWorkspace(processId: string | null | undefined, workspaceId: string): Promise<boolean> {
  if (!processId) return true;
  const [row] = await db
    .select({ id: beanProcesses.id })
    .from(beanProcesses)
    .where(and(eq(beanProcesses.id, processId), eq(beanProcesses.workspaceId, workspaceId)))
    .limit(1);
  return !!row;
}

beansRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<BeanResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;

  const body = parseBody(createBeanSchema, req, res);
  if (!body) return;
  if (priceMismatch(body.priceAmount, body.priceCurrency)) {
    sendError(res, 400, PRICE_ERROR);
    return;
  }
  const roast = resolveRoastLevel(body, null);
  if ("error" in roast) {
    sendError(res, 400, roast.error);
    return;
  }
  if (!(await processInWorkspace(body.processId, workspaceId))) {
    sendError(res, 400, PROCESS_ERROR);
    return;
  }

  const id = randomUUID();
  await db.insert(beans).values({ id, workspaceId, ...body, roastLevel: roast.roastLevel ?? null });
  const [bean] = await loadBeans(eq(beans.id, id));
  if (!bean) {
    throw new Error(`Bean ${id} missing after insert`);
  }
  res.status(201).json({ bean });
});

beansRouter.patch("/:beanId", async (req: Request<BeanParams>, res: Response<BeanResponse>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;

  const body = parseBody(updateBeanSchema, req, res);
  if (!body) return;

  // The price and roast rules are checked against the stored row with the
  // change applied, so the row is locked until the update is written.
  const outcome = await db.transaction(async (tx) => {
    // Scoped to the workspace, so a bean ID from another workspace is not found.
    const [existing] = await tx
      .select({ priceAmount: beans.priceAmount, priceCurrency: beans.priceCurrency, detailedRoastLevel: beans.detailedRoastLevel })
      .from(beans)
      .where(beanInWorkspace(req.params))
      .for("update");
    if (!existing) return { status: "not_found" } as const;
    const amount = body.priceAmount === undefined ? existing.priceAmount : body.priceAmount;
    const currency = body.priceCurrency === undefined ? existing.priceCurrency : body.priceCurrency;
    if (priceMismatch(amount, currency)) return { status: "invalid", error: PRICE_ERROR } as const;
    const roast = resolveRoastLevel(body, existing.detailedRoastLevel);
    if ("error" in roast) return { status: "invalid", error: roast.error } as const;
    if (!(await processInWorkspace(body.processId, req.params.workspaceId))) return { status: "invalid", error: PROCESS_ERROR } as const;
    const { archived, ...fields } = body;
    await tx
      .update(beans)
      .set({
        ...fields,
        roastLevel: roast.roastLevel,
        ...(archived === true ? { archivedAt: sql`COALESCE(${beans.archivedAt}, NOW())` } : {}),
        ...(archived === false ? { archivedAt: null } : {}),
      })
      .where(beanInWorkspace(req.params));
    return { status: "updated" } as const;
  });
  if (outcome.status === "invalid") {
    sendError(res, 400, outcome.error);
    return;
  }
  const [bean] = outcome.status === "updated" ? await loadBeans(beanInWorkspace(req.params)) : [];
  if (!bean) {
    sendError(res, 404, "Bean not found");
    return;
  }
  res.json({ bean });
});

// Deleting cascades to brew logs and their analyses, so a bean with history
// is only deleted when the client confirms with ?deleteBrewLogs=true.
beansRouter.delete("/:beanId", async (req: Request<BeanParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const confirmed = req.query.deleteBrewLogs === "true";

  const outcome = await db.transaction(async (tx) => {
    const [bean] = await tx
      .select({ id: beans.id })
      .from(beans)
      .where(beanInWorkspace(req.params))
      .for("update");
    if (!bean) return { status: "not_found" } as const;

    if (!confirmed) {
      const [{ brewLogCount } = { brewLogCount: 0 }] = await tx
        .select({ brewLogCount: count() })
        .from(brewLogs)
        .where(eq(brewLogs.beanId, bean.id));
      if (brewLogCount > 0) return { status: "has_logs", brewLogCount } as const;
    }

    // The photo rows cascade; their files go after the commit.
    const photoIds = (await tx.select({ id: beanPhotos.id }).from(beanPhotos).where(eq(beanPhotos.beanId, bean.id))).map((p) => p.id);
    await tx.delete(beans).where(eq(beans.id, bean.id));
    return { status: "deleted", photoIds } as const;
  });

  if (outcome.status === "not_found") {
    sendError(res, 404, "Bean not found");
    return;
  }
  if (outcome.status === "has_logs") {
    sendError(
      res,
      409,
      `This bean has ${outcome.brewLogCount} brew log(s) that would be permanently deleted. ` +
        "Retry with ?deleteBrewLogs=true to confirm, or hide the bean instead.",
      { brewLogCount: outcome.brewLogCount }
    );
    return;
  }
  await removePhotoFiles(req.params.workspaceId, outcome.photoIds);
  res.status(204).end();
});

// Freeze/thaw (docs/api/beans.md §4). Both lock the bean row, so concurrent
// requests can't open two periods or thaw twice.
async function changeFreezeState(req: Request<BeanParams>, res: Response<BeanResponse>, action: "freeze" | "thaw"): Promise<void> {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(freezeBodySchema, req, res);
  if (!body) return;
  const date = body.date ?? serverToday();
  if (date > serverToday(1)) {
    sendError(res, 400, "date: can't be in the future");
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [bean] = await tx
      .select({ id: beans.id, roastDate: beans.roastDate })
      .from(beans)
      .where(beanInWorkspace(req.params))
      .for("update");
    if (!bean) return { status: 404, error: "Bean not found" } as const;

    const [open] = await tx
      .select({ id: beanFreezes.id, frozenOn: beanFreezes.frozenOn })
      .from(beanFreezes)
      .where(and(eq(beanFreezes.beanId, bean.id), isNull(beanFreezes.thawedOn)))
      .limit(1);

    if (action === "freeze") {
      if (open) return { status: 409, error: "This bean is already frozen" } as const;
      const roastDay = bean.roastDate?.toISOString().slice(0, 10);
      if (roastDay && date < roastDay) return { status: 400, error: `date: can't be before the roast date (${roastDay})` } as const;
      const [last] = await tx
        .select({ thawedOn: beanFreezes.thawedOn })
        .from(beanFreezes)
        .where(eq(beanFreezes.beanId, bean.id))
        .orderBy(desc(beanFreezes.thawedOn))
        .limit(1);
      if (last?.thawedOn && date < last.thawedOn) {
        return { status: 400, error: `date: can't be before the last thaw (${last.thawedOn})` } as const;
      }
      await tx.insert(beanFreezes).values({ id: randomUUID(), beanId: bean.id, frozenOn: date });
    } else {
      if (!open) return { status: 409, error: "This bean isn't frozen" } as const;
      if (date < open.frozenOn) return { status: 400, error: `date: can't be before it was frozen (${open.frozenOn})` } as const;
      await tx.update(beanFreezes).set({ thawedOn: date }).where(eq(beanFreezes.id, open.id));
    }
    return { status: 200 } as const;
  });

  if (outcome.status !== 200) {
    sendError(res, outcome.status, outcome.error);
    return;
  }
  const [bean] = await loadBeans(beanInWorkspace(req.params));
  if (!bean) {
    sendError(res, 404, "Bean not found");
    return;
  }
  res.json({ bean });
}

beansRouter.post("/:beanId/freeze", (req: Request<BeanParams>, res: Response<BeanResponse>) => changeFreezeState(req, res, "freeze"));
beansRouter.post("/:beanId/thaw", (req: Request<BeanParams>, res: Response<BeanResponse>) => changeFreezeState(req, res, "thaw"));

// Correcting the latest freeze period (docs/api/beans.md §4): its dates, an
// un-thaw (thawedOn: null) or deleting it. Periods never overlap, so the
// latest is the open one, else the one thawed last; only it can change, so the
// rules only need the period before it.
const editFreezeSchema = z
  .object({ frozenOn: z.iso.date().optional(), thawedOn: z.iso.date().nullable().optional() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Provide frozenOn or thawedOn");

type FreezeRow = { id: string; frozenOn: string; thawedOn: string | null };
// Latest first: the open period, then by thaw date, then freeze date.
function byLatest(a: FreezeRow, b: FreezeRow): number {
  if (a.thawedOn === null || b.thawedOn === null) return a.thawedOn === b.thawedOn ? 0 : a.thawedOn === null ? -1 : 1;
  return b.thawedOn.localeCompare(a.thawedOn) || b.frozenOn.localeCompare(a.frozenOn);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function lockedPeriods(tx: Tx, params: BeanParams) {
  const [bean] = await tx
    .select({ id: beans.id, roastDate: beans.roastDate })
    .from(beans)
    .where(beanInWorkspace(params))
    .for("update");
  if (!bean) return null;
  const periods = await tx
    .select({ id: beanFreezes.id, frozenOn: beanFreezes.frozenOn, thawedOn: beanFreezes.thawedOn })
    .from(beanFreezes)
    .where(eq(beanFreezes.beanId, bean.id));
  const [latest, previous] = [...periods].sort(byLatest);
  return { bean, latest, previous };
}

async function sendBean(req: Request<BeanParams>, res: Response<BeanResponse>): Promise<void> {
  const [bean] = await loadBeans(beanInWorkspace(req.params));
  if (!bean) {
    sendError(res, 404, "Bean not found");
    return;
  }
  res.json({ bean });
}

beansRouter.patch("/:beanId/freezes/latest", async (req: Request<BeanParams>, res: Response<BeanResponse>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(editFreezeSchema, req, res);
  if (!body) return;

  const outcome = await db.transaction(async (tx) => {
    const found = await lockedPeriods(tx, req.params);
    if (!found) return { status: 404, error: "Bean not found" } as const;
    const { bean, latest, previous } = found;
    if (!latest) return { status: 404, error: "This bean has never been frozen" } as const;

    const frozenOn = body.frozenOn ?? latest.frozenOn;
    const thawedOn = body.thawedOn === undefined ? latest.thawedOn : body.thawedOn;
    const latestAllowed = serverToday(1);
    const roastDay = bean.roastDate?.toISOString().slice(0, 10);
    const bad = (error: string) => ({ status: 400, error }) as const;
    if (frozenOn > latestAllowed) return bad("frozenOn: can't be in the future");
    if (roastDay && frozenOn < roastDay) return bad(`frozenOn: can't be before the roast date (${roastDay})`);
    if (previous?.thawedOn && frozenOn < previous.thawedOn) return bad(`frozenOn: can't be before the previous thaw (${previous.thawedOn})`);
    if (thawedOn !== null && thawedOn > latestAllowed) return bad("thawedOn: can't be in the future");
    if (thawedOn !== null && thawedOn < frozenOn) return bad(`thawedOn: can't be before it was frozen (${frozenOn})`);

    await tx.update(beanFreezes).set({ frozenOn, thawedOn }).where(eq(beanFreezes.id, latest.id));
    return { status: 200 } as const;
  });
  if (outcome.status !== 200) {
    sendError(res, outcome.status, outcome.error);
    return;
  }
  await sendBean(req, res);
});

beansRouter.delete("/:beanId/freezes/latest", async (req: Request<BeanParams>, res: Response<BeanResponse>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const outcome = await db.transaction(async (tx) => {
    const found = await lockedPeriods(tx, req.params);
    if (!found) return { status: 404, error: "Bean not found" } as const;
    if (!found.latest) return { status: 404, error: "This bean has never been frozen" } as const;
    await tx.delete(beanFreezes).where(eq(beanFreezes.id, found.latest.id));
    return { status: 200 } as const;
  });
  if (outcome.status !== 200) {
    sendError(res, outcome.status, outcome.error);
    return;
  }
  await sendBean(req, res);
});
