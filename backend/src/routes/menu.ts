import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNotNull, max, or } from "drizzle-orm";
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { addUsageRoute, otherItemUsage } from "../usage.js";
import { PHOTO_MAX_UPLOAD_BYTES, processPhoto, removePhotoFiles, writePhotoFile } from "../photos.js";
import { buildPublicMenu, type PublicMenuResponse } from "./publicMenu.js";
import {
  BEAN_BATCH_MODES,
  BEAN_MENU_FIELDS,
  MAX_MENU_LOGOS,
  MAX_MENU_SIZES,
  brewers,
  drinks,
  MENU_ITEM_TYPES,
  menuItems,
  menuOtherItems,
  menuSections,
  workspaces,
  type BeanBatchMode,
  type BeanMenuField,
  type MenuItemType,
  type MenuSize,
  type MethodKind,
  brewerMethods,
  METHOD_NAMES,
} from "@barista/shared/schema";
import { decimalSchema, optionalText, updateSchema } from "../validation.js";

// docs/api/menu.md §7b: the menu builder. Sections and items arranged by hand;
// the public menu (§7) renders them.

// An item's source, for the builder to show (and flag when it's archived).
export interface MenuItemSource {
  name: string;
  description: string | null;
  kind: MethodKind | null; // null for an other item
  archived: boolean; // an archived brewer is left off the public menu
  method: string | null; // how it's made: a brewer's method name ("Siphon"), or a drink's ("Filter"); null for an other item
}
// docs/api/menu.md §7b "Other items": things on the menu that aren't a drink
// or brewer, placed in sections like drinks.
export interface MenuOtherItemView {
  id: string;
  name: string;
  description: string | null;
  menuItemCount: number; // how many sections show it
}
export interface MenuItemView {
  id: string;
  itemType: MenuItemType;
  drinkId: string | null;
  brewerId: string | null;
  otherItemId: string | null;
  name: string | null; // override; null = the source's
  description: string | null;
  price: number | null;
  available: boolean;
  source: MenuItemSource | null; // null for the beans block
  beanFields: BeanMenuField[] | null; // the beans block: what guests see per bean; null = all
  beanBatches: BeanBatchMode | null; // the beans block: same coffee twice; null = "each"
  // Drinks and brewers: show how it's made / the ingredients; null = the menu's default
  // (always null on the beans block and other items).
  showMethod: boolean | null;
  showIngredients: boolean | null;
  sizes: MenuSize[] | null; // not the beans block: a price per size, instead of price
}
export interface MenuSectionView {
  id: string;
  name: string;
  description: string | null;
  position: number;
  items: MenuItemView[];
}
export interface MenuResponse {
  title: string | null; // the public menu's title; null = the workspace name
  currency: string | null;
  showMethod: boolean; // the default for items: show how it's made ("Filter")
  showIngredients: boolean; // the default for items: show a drink's ingredients
  // Branding: an accent colour ("#rrggbb"), a line under the title, and the
  // logos, in order (each image: GET /api/public/menu/:slug/logo/:id). The
  // first, logoId, is the one the menu shows; the others are kept to swap in.
  accentColor: string | null;
  tagline: string | null;
  logoId: string | null;
  logoIds: string[];
  sections: MenuSectionView[];
  otherItems: MenuOtherItemView[]; // by name
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

const SIZES_OR_PRICE = "sizes: an item has one price or a price per size, not both";
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "must be a 3-letter currency code, e.g. USD")
  .nullable();
// Menu settings: the prices' currency and the menu's title (blank = the workspace name).
// showMethod / showIngredients: what items show by default.
// accentColor: "#rrggbb" (stored lowercase); tagline: a line under the title.
const settingsSchema = updateSchema({
  currency: currencySchema,
  title: optionalText(255),
  showMethod: z.boolean(),
  showIngredients: z.boolean(),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "must be a colour like #8a4b2a")
    .transform((c) => c.toLowerCase())
    .nullable(),
  tagline: optionalText(255),
});

const sectionFields = { name: z.string().trim().min(1).max(100), description: optionalText(500) };
const createSectionSchema = z.object(sectionFields).strict();
const updateSectionSchema = updateSchema(sectionFields);

const beanFieldsSchema = z
  .array(z.enum(BEAN_MENU_FIELDS))
  .refine((list) => new Set(list).size === list.length, "each field once")
  .nullable()
  .optional();
const priceSchema = decimalSchema({ min: 0, max: 1_000_000, scale: 2, exclusiveMax: true });
const sizesSchema = z
  .array(z.object({ label: z.string().trim().min(1).max(30), price: priceSchema.nullable() }).strict())
  .min(1)
  .max(MAX_MENU_SIZES)
  .refine((list) => new Set(list.map((x) => x.label.toLowerCase())).size === list.length, "each size once")
  .nullable()
  .optional();
const sizePriced = (sizes: MenuSize[] | null | undefined) => !!sizes?.some((x) => x.price !== null);
const itemFields = {
  beanFields: beanFieldsSchema, // the beans block only (checked below)
  beanBatches: z.enum(BEAN_BATCH_MODES).nullable().optional(), // the beans block only
  showMethod: z.boolean().nullable().optional(), // drinks and brewers only
  showIngredients: z.boolean().nullable().optional(),
  name: optionalText(255),
  description: optionalText(500),
  price: priceSchema.nullable().optional(),
  sizes: sizesSchema, // not for the beans block; never with a price
  available: z.boolean().optional(),
};
// The source id each type needs (and the others it mustn't have).
const SOURCE_ID = { drink: "drinkId", brewer: "brewerId", other: "otherItemId", beans: null } as const;
const createItemSchema = z
  .object({ itemType: z.enum(MENU_ITEM_TYPES), drinkId: z.uuid().optional(), brewerId: z.uuid().optional(), otherItemId: z.uuid().optional(), ...itemFields })
  .strict()
  .refine(
    (b) => (["drinkId", "brewerId", "otherItemId"] as const).every((k) => !!b[k] === (SOURCE_ID[b.itemType] === k)),
    "a drink item needs drinkId, a brewer item brewerId, an other item otherItemId, and the beans block none"
  )
  .refine((b) => b.itemType !== "other" || (b.showMethod == null && b.showIngredients == null), "showMethod, showIngredients: not for other items")
  .refine((b) => b.itemType === "beans" || (b.beanFields == null && b.beanBatches == null), "beanFields, beanBatches: only for the beans block")
  .refine((b) => b.itemType !== "beans" || (b.showMethod == null && b.showIngredients == null && b.sizes == null), "showMethod, showIngredients, sizes: not for the beans block")
  .refine((b) => b.price == null || b.sizes == null, SIZES_OR_PRICE);
// One item, or several at once (the add picker): { items: [...] }, all or nothing.
const addItemsSchema = z.union([
  z.object({ items: z.array(createItemSchema).min(1).max(100) }).strict(),
  createItemSchema,
]);
type NewItem = z.infer<typeof createItemSchema>;
const updateItemSchema = updateSchema(itemFields);

const otherItemFields = { name: z.string().trim().min(1).max(100), description: optionalText(500) };
const createOtherItemSchema = z.object(otherItemFields).strict();
const updateOtherItemSchema = updateSchema(otherItemFields);

const layoutSchema = z
  .object({
    sections: z
      .array(z.object({ id: z.uuid(), itemIds: z.array(z.uuid()).max(500) }).strict())
      .max(100),
  })
  .strict();

const PRICE_NEEDS_CURRENCY = "price: set the menu's currency first";

export async function loadMenu(workspaceId: string, conn: Db = db): Promise<MenuResponse> {
  const [ws] = await conn
    .select({
      currency: workspaces.menuCurrency,
      title: workspaces.menuTitle,
      showMethod: workspaces.menuShowMethod,
      showIngredients: workspaces.menuShowIngredients,
      accentColor: workspaces.menuAccentColor,
      tagline: workspaces.menuTagline,
      logoIds: workspaces.menuLogoIds,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
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
          otherItemId: menuItems.otherItemId,
          name: menuItems.name,
          description: menuItems.description,
          price: menuItems.price,
          available: menuItems.available,
          beanFields: menuItems.beanFields,
          beanBatches: menuItems.beanBatches,
          showMethod: menuItems.showMethod,
          showIngredients: menuItems.showIngredients,
          sizes: menuItems.sizes,
          drinkName: drinks.name,
          drinkDescription: drinks.description,
          drinkKind: drinks.kind,
          brewerName: brewers.name,
          brewerKind: brewers.kind,
          brewerMethod: brewerMethods.name,
          brewerArchivedAt: brewers.archivedAt,
          otherName: menuOtherItems.name,
          otherDescription: menuOtherItems.description,
        })
        .from(menuItems)
        .leftJoin(drinks, eq(drinks.id, menuItems.drinkId))
        .leftJoin(menuOtherItems, eq(menuOtherItems.id, menuItems.otherItemId))
        .leftJoin(brewers, eq(brewers.id, menuItems.brewerId))
        .leftJoin(brewerMethods, eq(brewerMethods.id, brewers.methodId))
        .where(inArray(menuItems.sectionId, sections.map((s) => s.id)))
        .orderBy(asc(menuItems.position))
    : [];
  const otherItems = await conn
    .select({ id: menuOtherItems.id, name: menuOtherItems.name, description: menuOtherItems.description, menuItemCount: count(menuItems.id) })
    .from(menuOtherItems)
    .leftJoin(menuItems, eq(menuItems.otherItemId, menuOtherItems.id))
    .where(eq(menuOtherItems.workspaceId, workspaceId))
    .groupBy(menuOtherItems.id)
    .orderBy(asc(menuOtherItems.name));
  return {
    title: ws?.title ?? null,
    currency: ws?.currency ?? null,
    showMethod: ws?.showMethod ?? true,
    showIngredients: ws?.showIngredients ?? false,
    accentColor: ws?.accentColor ?? null,
    tagline: ws?.tagline ?? null,
    logoId: ws?.logoIds?.[0] ?? null,
    logoIds: ws?.logoIds ?? [],
    sections: sections.map((s) => ({
      ...s,
      items: items
        .filter((i) => i.sectionId === s.id)
        .map(({ sectionId: _s, drinkName, drinkDescription, drinkKind, brewerName, brewerKind, brewerMethod, brewerArchivedAt, otherName, otherDescription, ...item }) => ({
          ...item,
          beanFields: item.itemType === "beans" ? (item.beanFields ?? null) : null,
          beanBatches: item.itemType === "beans" ? (item.beanBatches ?? null) : null,
          showMethod: item.itemType === "beans" || item.itemType === "other" ? null : item.showMethod,
          showIngredients: item.itemType === "beans" || item.itemType === "other" ? null : item.showIngredients,
          sizes: item.itemType === "beans" ? null : (item.sizes ?? null),
          source:
            item.itemType === "drink" && drinkName !== null && drinkKind !== null
              ? { name: drinkName, description: drinkDescription, kind: drinkKind, method: METHOD_NAMES[drinkKind], archived: false }
              : item.itemType === "brewer" && brewerName !== null && brewerKind !== null
                ? { name: brewerName, description: null, kind: brewerKind, method: brewerMethod ?? METHOD_NAMES[brewerKind], archived: brewerArchivedAt !== null }
                : item.itemType === "other" && otherName !== null
                  ? { name: otherName, description: otherDescription, kind: null, method: null, archived: false }
                  : null,
        })),
    })),
    otherItems,
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
    .select({ id: menuItems.id, price: menuItems.price, sizes: menuItems.sizes, itemType: menuItems.itemType })
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

// docs/api/menu.md §7b "Other items". The list itself comes with the menu
// (otherItems); every write returns the whole menu.
interface OtherItemParams extends WorkspaceParams {
  otherItemId: string;
}
const otherItemInWorkspace = (p: OtherItemParams) => and(eq(menuOtherItems.id, p.otherItemId), eq(menuOtherItems.workspaceId, p.workspaceId));
const OTHER_ITEM_TAKEN = "An other item with that name already exists";
// GET /other-items/:otherItemId/usage: how many sections show it (DeleteDialog).
const otherItemsUsageRouter = Router({ mergeParams: true });
addUsageRoute(otherItemsUsageRouter, "otherItemId", "menuOtherItems", otherItemUsage, "Other item not found");
menuRouter.use("/other-items", otherItemsUsageRouter);
menuRouter.post("/other-items", async (req: Request<WorkspaceParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createOtherItemSchema, req, res);
  if (!body) return;
  try {
    await db.insert(menuOtherItems).values({ id: randomUUID(), workspaceId, name: body.name, description: body.description ?? null });
  } catch (err) {
    if (!isDuplicateEntryError(err)) throw err;
    sendError(res, 409, OTHER_ITEM_TAKEN);
    return;
  }
  await sendMenu(res, workspaceId, 201);
});
menuRouter.patch("/other-items/:otherItemId", async (req: Request<OtherItemParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateOtherItemSchema, req, res);
  if (!body) return;
  try {
    const [result] = await db.update(menuOtherItems).set(body).where(otherItemInWorkspace(req.params));
    if (result.affectedRows === 0) {
      sendError(res, 404, "Other item not found");
      return;
    }
  } catch (err) {
    if (!isDuplicateEntryError(err)) throw err;
    sendError(res, 409, OTHER_ITEM_TAKEN);
    return;
  }
  await sendMenu(res, workspaceId);
});
// Deletes it and takes it off every section (FK cascade).
menuRouter.delete("/other-items/:otherItemId", async (req: Request<OtherItemParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(menuOtherItems).where(otherItemInWorkspace(req.params));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Other item not found");
    return;
  }
  await sendMenu(res, workspaceId);
});

menuRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  await sendMenu(res, workspaceId);
});

// The menu as guests would see it (§7's shape), even while the public menu is off.
menuRouter.get("/preview", async (req: Request<WorkspaceParams>, res: Response<PublicMenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const [workspace] = await db
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, settings: workspaces.settings })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!workspace) {
    sendError(res, 404, "Workspace not found");
    return;
  }
  res.json(await buildPublicMenu(workspace));
});

// Menu settings: the currency of its prices.
menuRouter.patch("/", async (req: Request<WorkspaceParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(settingsSchema, req, res);
  if (!body) return;
  if (body.currency === null) {
    const priced = await db
      .select({ price: menuItems.price, sizes: menuItems.sizes })
      .from(menuItems)
      .innerJoin(menuSections, eq(menuSections.id, menuItems.sectionId))
      .where(and(eq(menuSections.workspaceId, workspaceId), or(isNotNull(menuItems.price), isNotNull(menuItems.sizes))));
    if (priced.some((i) => i.price !== null || sizePriced(i.sizes))) {
      sendError(res, 400, "currency: items have prices; clear them before removing the currency");
      return;
    }
  }
  await db
    .update(workspaces)
    .set({
      ...(body.currency !== undefined ? { menuCurrency: body.currency } : {}),
      ...(body.title !== undefined ? { menuTitle: body.title } : {}),
      ...(body.showMethod !== undefined ? { menuShowMethod: body.showMethod } : {}),
      ...(body.showIngredients !== undefined ? { menuShowIngredients: body.showIngredients } : {}),
      ...(body.accentColor !== undefined ? { menuAccentColor: body.accentColor } : {}),
      ...(body.tagline !== undefined ? { menuTagline: body.tagline } : {}),
    })
    .where(eq(workspaces.id, workspaceId));
  await sendMenu(res, workspaceId);
});

// --- The logos (docs/api/menu.md §7b): up to MAX_MENU_LOGOS, stored like
// bean photos; the first is the one the menu shows ---
const imageBody = express.raw({ type: () => true, limit: PHOTO_MAX_UPLOAD_BYTES });
const NOT_AN_IMAGE = "Not an image that can be read (JPEG, PNG, WebP, GIF, AVIF or TIFF)";
const readImage = (req: { body: unknown }) => (Buffer.isBuffer(req.body) && req.body.length > 0 ? processPhoto(req.body) : Promise.resolve(null));

// Changes the list with the workspace row locked, so two uploads at once
// both land. `change` returns the new list, or a status to answer with.
type LogoChange = (ids: string[]) => string[] | { status: 400 | 404 | 409; error: string };
async function changeLogos(workspaceId: string, change: LogoChange): Promise<{ status: 400 | 404 | 409; error: string } | null> {
  return db.transaction(async (tx) => {
    const [ws] = await tx.select({ ids: workspaces.menuLogoIds }).from(workspaces).where(eq(workspaces.id, workspaceId)).for("update");
    const next = change(ws?.ids ?? []);
    if (!Array.isArray(next)) return next;
    await tx.update(workspaces).set({ menuLogoIds: next.length ? next : null }).where(eq(workspaces.id, workspaceId));
    return null;
  });
}

// Added last. Each image gets its own id, never reused: it's cached for good.
menuRouter.post("/logos", imageBody, async (req: Request<WorkspaceParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const image = await readImage(req);
  if (!image) {
    sendError(res, 400, NOT_AN_IMAGE);
    return;
  }
  const id = randomUUID();
  await writePhotoFile(workspaceId, id, image.data); // the file first: the list never points at a missing file
  const failed = await changeLogos(workspaceId, (ids) =>
    ids.length >= MAX_MENU_LOGOS ? { status: 409, error: `A menu keeps at most ${MAX_MENU_LOGOS} logos` } : [...ids, id],
  );
  if (failed) {
    await removePhotoFiles(workspaceId, [id]);
    sendError(res, failed.status, failed.error);
    return;
  }
  await sendMenu(res, workspaceId, 201);
});

const logoOrderSchema = z
  .object({ logoIds: z.array(z.uuid()).max(MAX_MENU_LOGOS).refine((ids) => new Set(ids).size === ids.length, "each logo once") })
  .strict();

// Every logo once, in the new order: the first is the one the menu shows.
menuRouter.put("/logos/order", async (req: Request<WorkspaceParams>, res: Response<MenuResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(logoOrderSchema, req, res);
  if (!body) return;
  const failed = await changeLogos(workspaceId, (ids) =>
    ids.length === body.logoIds.length && body.logoIds.every((id) => ids.includes(id))
      ? body.logoIds
      : { status: 400, error: "logoIds: must list every logo exactly once" },
  );
  if (failed) {
    sendError(res, failed.status, failed.error);
    return;
  }
  await sendMenu(res, workspaceId);
});

// A new image for a logo (cropped or rotated in the browser), in its place,
// under a new id. Works on a full list.
menuRouter.put("/logos/:logoId/image", imageBody, async (req: Request<WorkspaceParams & { logoId: string }>, res: Response<MenuResponse>) => {
  const { workspaceId, logoId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const image = await readImage(req);
  if (!image) {
    sendError(res, 400, NOT_AN_IMAGE);
    return;
  }
  const id = randomUUID();
  await writePhotoFile(workspaceId, id, image.data);
  const failed = await changeLogos(workspaceId, (ids) =>
    ids.includes(logoId) ? ids.map((x) => (x === logoId ? id : x)) : { status: 404, error: "Logo not found" },
  );
  if (failed) {
    await removePhotoFiles(workspaceId, [id]);
    sendError(res, failed.status, failed.error);
    return;
  }
  await removePhotoFiles(workspaceId, [logoId]);
  await sendMenu(res, workspaceId);
});

// No confirmation: nothing else uses a logo. The next one moves up.
menuRouter.delete("/logos/:logoId", async (req: Request<WorkspaceParams & { logoId: string }>, res: Response<MenuResponse>) => {
  const { workspaceId, logoId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const failed = await changeLogos(workspaceId, (ids) => (ids.includes(logoId) ? ids.filter((x) => x !== logoId) : { status: 404, error: "Logo not found" }));
  if (failed) {
    sendError(res, failed.status, failed.error);
    return;
  }
  await removePhotoFiles(workspaceId, [logoId]);
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
            .select({ id: menuItems.id, drinkId: menuItems.drinkId, brewerId: menuItems.brewerId, otherItemId: menuItems.otherItemId })
            .from(menuItems)
            .where(inArray(menuItems.sectionId, [...sectionIds]))
            .for("update")
        : [];
      const byId = new Map(items.map((i) => [i.id, i]));
      const placed = body.sections.flatMap((s) => s.itemIds);
      if (placed.length !== byId.size || new Set(placed).size !== placed.length || !placed.every((id) => byId.has(id))) {
        return "sections: must place every item of this menu exactly once";
      }
      // A drink, brewer or other item once per section, after the moves.
      for (const s of body.sections) {
        const refs = s.itemIds
          .map((id) => byId.get(id)!)
          .flatMap((i) => (i.drinkId ? [`d:${i.drinkId}`] : i.brewerId ? [`b:${i.brewerId}`] : i.otherItemId ? [`o:${i.otherItemId}`] : []));
        if (new Set(refs).size !== refs.length) return "sections: a drink, brewer or other item can only be in a section once";
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

// A refused item in an add: thrown so the transaction rolls back every item.
class AddRefused extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

// Checks one new item and inserts it at `position`.
async function addItem(tx: Db, workspaceId: string, sectionId: string, body: NewItem, position: number, hasCurrency: boolean): Promise<void> {
  if ((body.price != null || sizePriced(body.sizes)) && !hasCurrency) throw new AddRefused(400, PRICE_NEEDS_CURRENCY);
  if (body.drinkId) {
    const [d] = await tx.select({ id: drinks.id }).from(drinks).where(and(eq(drinks.id, body.drinkId), eq(drinks.workspaceId, workspaceId)));
    if (!d) throw new AddRefused(400, "drinkId: not a drink in this workspace");
  }
  if (body.brewerId) {
    const [b] = await tx.select({ id: brewers.id }).from(brewers).where(and(eq(brewers.id, body.brewerId), eq(brewers.workspaceId, workspaceId)));
    if (!b) throw new AddRefused(400, "brewerId: not a brewer in this workspace");
  }
  if (body.otherItemId) {
    const [o] = await tx
      .select({ id: menuOtherItems.id })
      .from(menuOtherItems)
      .where(and(eq(menuOtherItems.id, body.otherItemId), eq(menuOtherItems.workspaceId, workspaceId)));
    if (!o) throw new AddRefused(400, "otherItemId: not an other item in this workspace");
  }
  if (body.itemType === "beans") {
    const [existing] = await tx
      .select({ id: menuItems.id })
      .from(menuItems)
      .innerJoin(menuSections, eq(menuSections.id, menuItems.sectionId))
      .where(and(eq(menuSections.workspaceId, workspaceId), eq(menuItems.itemType, "beans")))
      .limit(1);
    if (existing) throw new AddRefused(409, "The menu already has the beans block; move it instead");
  }
  try {
    await tx.insert(menuItems).values({
      id: randomUUID(),
      sectionId,
      position,
      itemType: body.itemType,
      drinkId: body.drinkId ?? null,
      brewerId: body.brewerId ?? null,
      otherItemId: body.otherItemId ?? null,
      name: body.name ?? null,
      description: body.description ?? null,
      price: body.price ?? null,
      sizes: body.sizes ?? null,
      available: body.available ?? true,
      beanFields: body.beanFields ?? null,
      beanBatches: body.beanBatches ?? null,
      showMethod: body.showMethod ?? null,
      showIngredients: body.showIngredients ?? null,
    });
  } catch (err) {
    if (isDuplicateEntryError(err)) throw new AddRefused(409, "That's already in this section");
    throw err;
  }
}

// New items go last in their section, in the order sent.
menuRouter.post("/sections/:sectionId/items", async (req: Request<SectionParams>, res: Response<MenuResponse>) => {
  const { workspaceId, sectionId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(addItemsSchema, req, res);
  if (!body) return;
  const list = "items" in body ? body.items : [body];

  try {
    await db.transaction(async (tx) => {
      const [section] = await tx
        .select({ id: menuSections.id })
        .from(menuSections)
        .where(and(eq(menuSections.id, sectionId), eq(menuSections.workspaceId, workspaceId)))
        .for("update");
      if (!section) throw new AddRefused(404, "Section not found");
      const hasCurrency = !!(await currencyOf(tx, workspaceId));
      const [{ last } = { last: 0 }] = await tx.select({ last: max(menuItems.position) }).from(menuItems).where(eq(menuItems.sectionId, sectionId));
      for (const [i, item] of list.entries()) await addItem(tx, workspaceId, sectionId, item, (last ?? 0) + 1 + i, hasCurrency);
    });
  } catch (err) {
    if (err instanceof AddRefused) {
      sendError(res, err.status, err.message);
      return;
    }
    throw err;
  }
  await sendMenu(res, workspaceId, 201);
});

menuRouter.patch("/items/:itemId", async (req: Request<ItemParams>, res: Response<MenuResponse>) => {
  const { workspaceId, itemId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateItemSchema, req, res);
  if (!body) return;
  const item = await itemInWorkspace(db, itemId, workspaceId);
  if (!item) {
    sendError(res, 404, "Menu item not found");
    return;
  }
  if ((body.beanFields !== undefined || body.beanBatches !== undefined) && item.itemType !== "beans") {
    sendError(res, 400, "beanFields, beanBatches: only for the beans block");
    return;
  }
  if ((body.showMethod !== undefined || body.showIngredients !== undefined || body.sizes !== undefined) && item.itemType === "beans") {
    sendError(res, 400, "showMethod, showIngredients, sizes: not for the beans block");
    return;
  }
  const price = body.price !== undefined ? body.price : item.price;
  const sizes = body.sizes !== undefined ? body.sizes : item.sizes;
  if (price != null && sizes != null) {
    sendError(res, 400, SIZES_OR_PRICE);
    return;
  }
  if ((body.price != null || sizePriced(body.sizes)) && !(await currencyOf(db, workspaceId))) {
    sendError(res, 400, PRICE_NEEDS_CURRENCY);
    return;
  }
  // An other item has nothing to show under it (docs/api/menu.md §7b).
  if (item.itemType === "other" && (body.showMethod !== undefined || body.showIngredients !== undefined)) {
    sendError(res, 400, "showMethod, showIngredients: not for other items");
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
