import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, max } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import {
  brewers,
  drinks,
  MENU_ITEM_TYPES,
  menuItems,
  menuSections,
  workspaces,
  type MenuItemType,
  type MethodKind,
} from "@barista/shared/schema";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";

// docs/api/menu.md §7b: the menu builder. Sections and items arranged by hand;
// the public menu (§7) renders them.

// An item's source, for the builder to show (and flag when it's retired).
export interface MenuItemSource {
  name: string;
  description: string | null;
  kind: MethodKind;
  retired: boolean; // a retired brewer is left off the public menu
}
export interface MenuItemView {
  id: string;
  itemType: MenuItemType;
  drinkId: string | null;
  brewerId: string | null;
  name: string | null; // override; null = the source's
  description: string | null;
  price: number | null;
  available: boolean;
  source: MenuItemSource | null; // null for the beans block
}
export interface MenuSectionView {
  id: string;
  name: string;
  description: string | null;
  position: number;
  items: MenuItemView[];
}
export interface MenuResponse {
  currency: string | null;
  sections: MenuSectionView[];
}

interface WorkspaceParams {
  workspaceId: string;
}
interface SectionParams extends WorkspaceParams {
  sectionId: string;
}
interface ItemParams extends WorkspaceParams {
  itemId: string;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "must be a 3-letter currency code, e.g. USD")
  .nullable();
const settingsSchema = z.object({ currency: currencySchema }).strict();

const sectionFields = { name: z.string().trim().min(1).max(100), description: optionalText(500) };
const createSectionSchema = z.object(sectionFields).strict();
const updateSectionSchema = updateSchema(sectionFields);

const itemFields = {
  name: optionalText(255),
  description: optionalText(500),
  price: decimalSchema({ min: 0, max: 1_000_000, scale: 2, exclusiveMax: true }).nullable().optional(),
  available: z.boolean().optional(),
};
const createItemSchema = z
  .object({ itemType: z.enum(MENU_ITEM_TYPES), drinkId: z.uuid().optional(), brewerId: z.uuid().optional(), ...itemFields })
  .strict()
  .refine(
    (b) => (b.itemType === "drink" ? !!b.drinkId && !b.brewerId : b.itemType === "brewer" ? !!b.brewerId && !b.drinkId : !b.drinkId && !b.brewerId),
    "a drink item needs drinkId, a brewer item brewerId, and the beans block neither"
  );
const updateItemSchema = updateSchema(itemFields);

const layoutSchema = z
  .object({
    sections: z
      .array(z.object({ id: z.uuid(), itemIds: z.array(z.uuid()).max(500) }).strict())
      .max(100),
  })
  .strict();

const PRICE_NEEDS_CURRENCY = "price: set the menu's currency first";

export async function loadMenu(workspaceId: string, conn: Db = db): Promise<MenuResponse> {
  const [ws] = await conn.select({ currency: workspaces.menuCurrency }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const sections = await conn
    .select({ id: menuSections.id, name: menuSections.name, description: menuSections.description, position: menuSections.position })
    .from(menuSections)
    .where(eq(menuSections.workspaceId, workspaceId))
    .orderBy(asc(menuSections.position), asc(menuSections.name));
  const items = sections.length
    ? await conn
        .select({
          id: menuItems.id,
          sectionId: menuItems.sectionId,
          itemType: menuItems.itemType,
          drinkId: menuItems.drinkId,
          brewerId: menuItems.brewerId,
          name: menuItems.name,
          description: menuItems.description,
          price: menuItems.price,
          available: menuItems.available,
          drinkName: drinks.name,
          drinkDescription: drinks.description,
          drinkKind: drinks.kind,
          brewerName: brewers.name,
          brewerKind: brewers.kind,
          brewerRetiredAt: brewers.retiredAt,
        })
        .from(menuItems)
        .leftJoin(drinks, eq(drinks.id, menuItems.drinkId))
        .leftJoin(brewers, eq(brewers.id, menuItems.brewerId))
        .where(inArray(menuItems.sectionId, sections.map((s) => s.id)))
        .orderBy(asc(menuItems.position))
    : [];
  return {
    currency: ws?.currency ?? null,
    sections: sections.map((s) => ({
      ...s,
      items: items
        .filter((i) => i.sectionId === s.id)
        .map(({ sectionId: _s, drinkName, drinkDescription, drinkKind, brewerName, brewerKind, brewerRetiredAt, ...item }) => ({
          ...item,
          source:
            item.itemType === "drink" && drinkName !== null && drinkKind !== null
              ? { name: drinkName, description: drinkDescription, kind: drinkKind, retired: false }
              : item.itemType === "brewer" && brewerName !== null && brewerKind !== null
                ? { name: brewerName, description: null, kind: brewerKind, retired: brewerRetiredAt !== null }
                : null,
        })),
    })),
  };
}

async function sendMenu(res: Response<MenuResponse>, workspaceId: string, status = 200): Promise<void> {
  res.status(status).json(await loadMenu(workspaceId));
}

async function sectionInWorkspace(conn: Db, sectionId: string, workspaceId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: menuSections.id })
    .from(menuSections)
    .where(and(eq(menuSections.id, sectionId), eq(menuSections.workspaceId, workspaceId)));
  return !!row;
}

// The item, if it's in this workspace's menu.
async function itemInWorkspace(conn: Db, itemId: string, workspaceId: string) {
  const [row] = await conn
    .select({ id: menuItems.id, price: menuItems.price })
    .from(menuItems)
    .innerJoin(menuSections, eq(menuSections.id, menuItems.sectionId))
    .where(and(eq(menuItems.id, itemId), eq(menuSections.workspaceId, workspaceId)));
  return row ?? null;
}

async function currencyOf(conn: Db, workspaceId: string): Promise<string | null> {
  const [ws] = await conn.select({ currency: workspaces.menuCurrency }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return ws?.currency ?? null;
}

// Mounted at /api/workspaces/:workspaceId/menu
export const menuRouter = Router({ mergeParams: true });
menuRouter.use(requireAuth);

menuRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  await sendMenu(res, workspaceId);
});

// Menu settings: the currency of its prices.
menuRouter.patch("/", async (req: Request<WorkspaceParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(settingsSchema, req, res);
  if (!body) return;
  if (body.currency === null) {
    const [priced] = await db
      .select({ id: menuItems.id })
      .from(menuItems)
      .innerJoin(menuSections, eq(menuSections.id, menuItems.sectionId))
      .where(and(eq(menuSections.workspaceId, workspaceId), isNotNull(menuItems.price)))
      .limit(1);
    if (priced) {
      sendError(res, 400, "currency: items have prices; clear them before removing the currency");
      return;
    }
  }
  await db.update(workspaces).set({ menuCurrency: body.currency }).where(eq(workspaces.id, workspaceId));
  await sendMenu(res, workspaceId);
});

const duplicateSection = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A section with that name already exists");
  return true;
};

// New sections go last.
menuRouter.post("/sections", async (req: Request<WorkspaceParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSectionSchema, req, res);
  if (!body) return;
  try {
    await db.transaction(async (tx) => {
      // Lock the menu's sections so two creates don't take the same position.
      await tx.select({ id: menuSections.id }).from(menuSections).where(eq(menuSections.workspaceId, workspaceId)).for("update");
      const [{ last } = { last: 0 }] = await tx
        .select({ last: max(menuSections.position) })
        .from(menuSections)
        .where(eq(menuSections.workspaceId, workspaceId));
      await tx.insert(menuSections).values({
        id: randomUUID(),
        workspaceId,
        name: body.name,
        description: body.description ?? null,
        position: (last ?? 0) + 1,
      });
    });
  } catch (err) {
    if (duplicateSection(res, err)) return;
    throw err;
  }
  await sendMenu(res, workspaceId, 201);
});

menuRouter.patch("/sections/:sectionId", async (req: Request<SectionParams>, res: Response<MenuResponse>) => {
  const { workspaceId, sectionId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateSectionSchema, req, res);
  if (!body) return;
  if (!(await sectionInWorkspace(db, sectionId, workspaceId))) {
    sendError(res, 404, "Section not found");
    return;
  }
  try {
    await db.update(menuSections).set(body).where(eq(menuSections.id, sectionId));
  } catch (err) {
    if (duplicateSection(res, err)) return;
    throw err;
  }
  await sendMenu(res, workspaceId);
});

// Deletes the section's items too (FK cascade).
menuRouter.delete("/sections/:sectionId", async (req: Request<SectionParams>, res: Response<MenuResponse>) => {
  const { workspaceId, sectionId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(menuSections).where(and(eq(menuSections.id, sectionId), eq(menuSections.workspaceId, workspaceId)));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Section not found");
    return;
  }
  await sendMenu(res, workspaceId);
});

// The whole arrangement at once, as a drag-and-drop editor has it: every
// section once, in order, each with its items in order. Items can move
// between sections; every item must appear exactly once.
menuRouter.put("/layout", async (req: Request<WorkspaceParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(layoutSchema, req, res);
  if (!body) return;

  let error: string | null;
  try {
    error = await db.transaction(async (tx) => {
      const sections = await tx
        .select({ id: menuSections.id })
        .from(menuSections)
        .where(eq(menuSections.workspaceId, workspaceId))
        .for("update");
      const sectionIds = new Set(sections.map((s) => s.id));
      const sent = body.sections.map((s) => s.id);
      if (sent.length !== sectionIds.size || new Set(sent).size !== sent.length || !sent.every((id) => sectionIds.has(id))) {
        return "sections: must list every section of this menu exactly once";
      }
      const items = sections.length
        ? await tx
            .select({ id: menuItems.id, drinkId: menuItems.drinkId, brewerId: menuItems.brewerId })
            .from(menuItems)
            .where(inArray(menuItems.sectionId, [...sectionIds]))
            .for("update")
        : [];
      const byId = new Map(items.map((i) => [i.id, i]));
      const placed = body.sections.flatMap((s) => s.itemIds);
      if (placed.length !== byId.size || new Set(placed).size !== placed.length || !placed.every((id) => byId.has(id))) {
        return "sections: must place every item of this menu exactly once";
      }
      // A drink or brewer once per section, after the moves.
      for (const s of body.sections) {
        const refs = s.itemIds.map((id) => byId.get(id)!).flatMap((i) => (i.drinkId ? [`d:${i.drinkId}`] : i.brewerId ? [`b:${i.brewerId}`] : []));
        if (new Set(refs).size !== refs.length) return "sections: a drink or brewer can only be in a section once";
      }
      for (const [i, s] of body.sections.entries()) {
        await tx.update(menuSections).set({ position: i + 1 }).where(eq(menuSections.id, s.id));
        for (const [j, itemId] of s.itemIds.entries()) {
          await tx.update(menuItems).set({ sectionId: s.id, position: j + 1 }).where(eq(menuItems.id, itemId));
        }
      }
      return null;
    });
  } catch (err) {
    // Two items swapping sections can collide midway; the final layout was checked above.
    if (!isDuplicateEntryError(err)) throw err;
    error = "sections: move one of the duplicate items at a time";
  }
  if (error) {
    sendError(res, 400, error);
    return;
  }
  await sendMenu(res, workspaceId);
});

// New items go last in their section.
menuRouter.post("/sections/:sectionId/items", async (req: Request<SectionParams>, res: Response<MenuResponse>) => {
  const { workspaceId, sectionId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createItemSchema, req, res);
  if (!body) return;

  const outcome = await db.transaction(async (tx) => {
    const [section] = await tx
      .select({ id: menuSections.id })
      .from(menuSections)
      .where(and(eq(menuSections.id, sectionId), eq(menuSections.workspaceId, workspaceId)))
      .for("update");
    if (!section) return { status: 404, error: "Section not found" } as const;
    if (body.price != null && !(await currencyOf(tx, workspaceId))) return { status: 400, error: PRICE_NEEDS_CURRENCY } as const;

    if (body.drinkId) {
      const [d] = await tx.select({ id: drinks.id }).from(drinks).where(and(eq(drinks.id, body.drinkId), eq(drinks.workspaceId, workspaceId)));
      if (!d) return { status: 400, error: "drinkId: not a drink in this workspace" } as const;
    }
    if (body.brewerId) {
      const [b] = await tx.select({ id: brewers.id }).from(brewers).where(and(eq(brewers.id, body.brewerId), eq(brewers.workspaceId, workspaceId)));
      if (!b) return { status: 400, error: "brewerId: not a brewer in this workspace" } as const;
    }
    if (body.itemType === "beans") {
      const [existing] = await tx
        .select({ id: menuItems.id })
        .from(menuItems)
        .innerJoin(menuSections, eq(menuSections.id, menuItems.sectionId))
        .where(and(eq(menuSections.workspaceId, workspaceId), eq(menuItems.itemType, "beans")))
        .limit(1);
      if (existing) return { status: 409, error: "The menu already has the beans block; move it instead" } as const;
    }

    const [{ last } = { last: 0 }] = await tx.select({ last: max(menuItems.position) }).from(menuItems).where(eq(menuItems.sectionId, sectionId));
    try {
      await tx.insert(menuItems).values({
        id: randomUUID(),
        sectionId,
        position: (last ?? 0) + 1,
        itemType: body.itemType,
        drinkId: body.drinkId ?? null,
        brewerId: body.brewerId ?? null,
        name: body.name ?? null,
        description: body.description ?? null,
        price: body.price ?? null,
        available: body.available ?? true,
      });
    } catch (err) {
      if (isDuplicateEntryError(err)) return { status: 409, error: "That's already in this section" } as const;
      throw err;
    }
    return { status: 201 } as const;
  });
  if (outcome.status !== 201) {
    sendError(res, outcome.status, outcome.error);
    return;
  }
  await sendMenu(res, workspaceId, 201);
});

menuRouter.patch("/items/:itemId", async (req: Request<ItemParams>, res: Response<MenuResponse>) => {
  const { workspaceId, itemId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateItemSchema, req, res);
  if (!body) return;
  if (!(await itemInWorkspace(db, itemId, workspaceId))) {
    sendError(res, 404, "Menu item not found");
    return;
  }
  if (body.price != null && !(await currencyOf(db, workspaceId))) {
    sendError(res, 400, PRICE_NEEDS_CURRENCY);
    return;
  }
  await db.update(menuItems).set(body).where(eq(menuItems.id, itemId));
  await sendMenu(res, workspaceId);
});

menuRouter.delete("/items/:itemId", async (req: Request<ItemParams>, res: Response<MenuResponse>) => {
  const { workspaceId, itemId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  if (!(await itemInWorkspace(db, itemId, workspaceId))) {
    sendError(res, 404, "Menu item not found");
    return;
  }
  await db.delete(menuItems).where(eq(menuItems.id, itemId));
  await sendMenu(res, workspaceId);
});
