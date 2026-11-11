import { access } from "node:fs/promises";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db } from "../db.js";
import { sendError } from "../http.js";
import { photoPath } from "../photos.js";
import { effectiveRoastAge } from "@barista/shared/roastAge";
import { BEAN_MENU_FIELDS, beanFreezes, beanProcesses, beans, DEFAULT_WORKSPACE_SETTINGS, drinkIngredients, drinks, ingredients, withDefaults, workspaces, type Bean, type BeanBatchMode, type BeanMenuField, type MenuSize, type MethodKind, type Workspace } from "@barista/shared/schema";
import { SLUG_PATTERN } from "../validation.js";
import { loadMenu } from "./menu.js";

// docs/api/public-menu.md §7: the menu as arranged in the builder (§7b).
// A bean always has its roaster and name; the rest only when the beans block
// shows that field (BEAN_MENU_FIELDS, chosen in the builder). Stock, price,
// website, notes, rating, purchase date and supplier stay private.
// process: the process's name (docs/api/bean-processes.md §4b).
type BeanDetails = { process: string | null } & Pick<
  Bean,
  | "roastDate" | "roastLevel" | "detailedRoastLevel" | "roastType" | "blendType" | "decaf"
  | "flavorProfile" | "originArea" | "country" | "region" | "altitudeMasl" | "producer" | "varieties" | "species"
>;
// A freeze period, so the guest page can count days off roast that pause while frozen.
export interface PublicFreeze {
  frozenOn: string;
  thawedOn: string | null;
}
// Two or more beans that are the same coffee (same roaster and name), listed
// each: what tells them apart (BEAN_MENU_FIELDS keys, or "batchNumber").
export type BeanDifference = BeanMenuField | "batchNumber";
export type PublicBean = Pick<Bean, "id" | "roasterName" | "beanName"> &
  Partial<BeanDetails> & {
    freezes?: PublicFreeze[]; // with roastDate
    batchNumber?: string | null; // only when it tells the same coffee apart
    differs?: BeanDifference[]; // only on the same coffee listed more than once
  };
type MenuBean = Pick<Bean, "id" | "roasterName" | "beanName" | "batchNumber"> & BeanDetails & { freezes: PublicFreeze[] };
// The bean columns each menu field shows.
const FIELD_COLUMNS: Record<BeanMenuField, ReadonlyArray<keyof BeanDetails>> = {
  flavorProfile: ["flavorProfile"],
  origin: ["originArea", "country", "region"],
  producer: ["producer"],
  altitude: ["altitudeMasl"],
  variety: ["varieties", "species"],
  process: ["process"],
  roastLevel: ["roastLevel", "detailedRoastLevel"],
  roastDate: ["roastDate"],
  decaf: ["decaf"],
  blendType: ["blendType"],
  roastType: ["roastType"],
};
function publicBean(bean: MenuBean, fields: readonly BeanMenuField[], differs?: BeanDifference[]): PublicBean {
  const out: PublicBean = { id: bean.id, roasterName: bean.roasterName, beanName: bean.beanName };
  // A difference the block hides is still sent: it's what tells the batches apart.
  const shown = [...new Set([...fields, ...(differs ?? []).filter((d): d is BeanMenuField => d !== "batchNumber")])];
  for (const f of shown) for (const key of FIELD_COLUMNS[f]) Object.assign(out, { [key]: bean[key] });
  if (shown.includes("roastDate") && bean.roastDate) out.freezes = bean.freezes;
  if (differs) {
    out.differs = differs;
    if (differs.includes("batchNumber")) out.batchNumber = bean.batchNumber;
  }
  return out;
}

const sameCoffee = (b: MenuBean) => `${b.roasterName.trim().toLowerCase()}\u0000${b.beanName.trim().toLowerCase()}`;
const today = () => new Date().toISOString().slice(0, 10);

// The beans block's beans (§7): the same coffee more than once (e.g. two
// batches) is either shown once, the freshest that isn't frozen, or listed
// each with what differs between them.
export function menuBeanList(list: MenuBean[], fields: readonly BeanMenuField[], mode: BeanBatchMode, onDate: string = today()): PublicBean[] {
  const groups = new Map<string, MenuBean[]>();
  for (const b of list) groups.set(sameCoffee(b), [...(groups.get(sameCoffee(b)) ?? []), b]);
  const out: PublicBean[] = [];
  const done = new Set<string>();
  for (const b of list) {
    const key = sameCoffee(b);
    const group = groups.get(key)!;
    if (group.length === 1) {
      out.push(publicBean(b, fields));
      continue;
    }
    if (mode === "once") {
      if (done.has(key)) continue;
      done.add(key);
      out.push(publicBean(freshest(group, onDate), fields));
      continue;
    }
    out.push(publicBean(b, fields, differences(group, fields)));
  }
  return out;
}

function freshest(group: MenuBean[], onDate: string): MenuBean {
  const frozen = (b: MenuBean) => b.freezes.some((f) => f.thawedOn === null && f.frozenOn <= onDate);
  const age = (b: MenuBean) => (b.roastDate ? effectiveRoastAge(b.roastDate.toISOString(), b.freezes, onDate).ageDays : Infinity);
  const pool = group.some((b) => !frozen(b)) ? group.filter((b) => !frozen(b)) : group;
  return pool.reduce((best, b) => (age(b) < age(best) ? b : best));
}

// What differs within a group: the shown details and batch number that do;
// if none of those do, any detail that does (even one the block hides).
function differences(group: MenuBean[], fields: readonly BeanMenuField[]): BeanDifference[] {
  const value = (b: MenuBean, d: BeanDifference) =>
    JSON.stringify(d === "batchNumber" ? b.batchNumber : FIELD_COLUMNS[d].map((k) => (k === "roastDate" ? (b.roastDate?.toISOString().slice(0, 10) ?? null) : b[k])));
  const all: BeanDifference[] = [...BEAN_MENU_FIELDS, "batchNumber"];
  const differ = all.filter((d) => new Set(group.map((b) => value(b, d))).size > 1);
  const shown = differ.filter((d) => d === "batchNumber" || fields.includes(d));
  return shown.length ? shown : differ;
}

export interface PublicMenuItem {
  type: "drink" | "brewer" | "other";
  id: string; // the drink, brewer or other item (docs/api/menu.md §7b)
  name: string;
  description: string | null;
  method: string | null; // how it's made: "Filter", "Espresso"; null = not shown
  variantOf: string | null;
  ingredients: string[]; // empty when not shown
  price: number | null;
  sizes: MenuSize[] | null; // a price per size, instead of price
  available: boolean;
}
export interface PublicBeansBlock {
  type: "beans";
  fields: BeanMenuField[]; // what each bean shows besides its roaster and name
  beans: PublicBean[];
}
export interface PublicMenuSection {
  name: string;
  description: string | null;
  items: Array<PublicMenuItem | PublicBeansBlock>;
}
export interface PublicMenuResponse {
  title: string; // the menu's title, else the workspace name
  tagline: string | null; // a line under the title
  accentColor: string | null; // "#rrggbb": headings and rules; null = the app's brown
  logoUrl: string | null; // the logo image (GET /api/public/menu/:slug/logo/:id)
  workspace: Pick<Workspace, "name" | "slug">;
  currency: string | null;
  sections: PublicMenuSection[];
}

// Mounted at /api/public/menu. Unauthenticated: only expose explicitly public data.
export const publicMenuRouter = Router();

publicMenuRouter.get(
  "/:slug",
  async (req: Request<{ slug: string }>, res: Response<PublicMenuResponse>) => {
    if (!SLUG_PATTERN.test(req.params.slug)) {
      sendError(res, 404, "Menu not found");
      return;
    }

    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, settings: workspaces.settings })
      .from(workspaces)
      .where(and(eq(workspaces.slug, req.params.slug), eq(workspaces.isPublicMenuEnabled, true)))
      .limit(1);

    // Same 404 whether the slug is unknown or the menu is disabled.
    if (!workspace) {
      sendError(res, 404, "Menu not found");
      return;
    }

    res.json(await buildPublicMenu(workspace));
  }
);

// A logo: the one the menu shows, or one kept to swap in. Served while the
// menu is off too, so the builder's preview and Settings show them: ids are
// unguessable and change with each upload, so only someone who has seen the
// menu (or a member) knows the URL.
publicMenuRouter.get("/:slug/logo/:logoId", async (req: Request<{ slug: string; logoId: string }>, res: Response) => {
  const { slug, logoId } = req.params;
  const [ws] = SLUG_PATTERN.test(slug) && /^[0-9a-f-]{36}$/.test(logoId)
    ? await db.select({ id: workspaces.id, logoIds: workspaces.menuLogoIds }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
    : [];
  const path = ws?.logoIds?.includes(logoId) ? photoPath(ws.id, logoId) : null;
  if (!path || !(await access(path).then(() => true, () => false))) {
    sendError(res, 404, "Logo not found");
    return;
  }
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type("image/webp").sendFile(path);
});

// The menu as guests see it (§7): also the builder's preview (§7b), which
// members can see while the public menu is off.
// A workspace that records roasts light to dark (settings.roastScale "levels")
// shows only the 5-step level: roast names it recorded earlier are left out.
export async function buildPublicMenu(workspace: Pick<Workspace, "id" | "name" | "slug" | "settings">): Promise<PublicMenuResponse> {
  const levelsOnly = withDefaults(DEFAULT_WORKSPACE_SETTINGS, workspace.settings).roastScale === "levels";
  const menu = await loadMenu(workspace.id);
  const allItems = menu.sections.flatMap((s) => s.items);
  const drinkIds = allItems.flatMap((i) => (i.drinkId ? [i.drinkId] : []));
  const hasBeans = allItems.some((i) => i.itemType === "beans");

  const [drinkRows, ingredientRows, menuBeans] = await Promise.all([
    drinkIds.length
      ? db.select({ id: drinks.id, parentDrinkId: drinks.parentDrinkId }).from(drinks).where(inArray(drinks.id, drinkIds))
      : Promise.resolve([]),
    drinkIds.length
      ? db
          .select({ drinkId: drinkIngredients.drinkId, name: ingredients.name })
          .from(drinkIngredients)
          .innerJoin(ingredients, eq(drinkIngredients.ingredientId, ingredients.id))
          .where(inArray(drinkIngredients.drinkId, drinkIds))
          .orderBy(asc(drinkIngredients.position))
      : Promise.resolve([]),
    hasBeans
      ? db
          .select({
            id: beans.id,
            batchNumber: beans.batchNumber,
            roasterName: beans.roasterName,
            beanName: beans.beanName,
            process: beanProcesses.name,
            roastDate: beans.roastDate,
            roastLevel: beans.roastLevel,
            detailedRoastLevel: beans.detailedRoastLevel,
            roastType: beans.roastType,
            blendType: beans.blendType,
            decaf: beans.decaf,
            flavorProfile: beans.flavorProfile,
            originArea: beans.originArea,
            country: beans.country,
            region: beans.region,
            altitudeMasl: beans.altitudeMasl,
            producer: beans.producer,
            varieties: beans.varieties,
            species: beans.species,
          })
          .from(beans)
          .leftJoin(beanProcesses, eq(beans.processId, beanProcesses.id))
          .where(and(eq(beans.workspaceId, workspace.id), eq(beans.showOnPublicMenu, true), isNull(beans.archivedAt)))
          .orderBy(asc(beans.roasterName), asc(beans.beanName))
      : Promise.resolve([]),
  ]);

  const freezeRows = menuBeans.length
    ? await db
        .select({ beanId: beanFreezes.beanId, frozenOn: beanFreezes.frozenOn, thawedOn: beanFreezes.thawedOn })
        .from(beanFreezes)
        .where(inArray(beanFreezes.beanId, menuBeans.map((b) => b.id)))
        .orderBy(asc(beanFreezes.frozenOn))
    : [];
  const withFreezes: MenuBean[] = menuBeans.map((b) => ({
    ...b,
    ...(levelsOnly ? { detailedRoastLevel: null } : {}),
    freezes: freezeRows.filter((f) => f.beanId === b.id).map(({ frozenOn, thawedOn }) => ({ frozenOn, thawedOn })),
  }));

  // Name a parent drink only if it's on the menu too, so hidden drinks stay hidden.
  const parentOf = new Map(drinkRows.map((d) => [d.id, d.parentDrinkId]));
  const menuNameOf = new Map<string, string>();
  for (const i of allItems) if (i.drinkId && i.source) menuNameOf.set(i.drinkId, i.name ?? i.source.name);

  const sections: PublicMenuSection[] = menu.sections
    .map((s) => ({
      name: s.name,
      description: s.description,
      items: s.items.flatMap((i): Array<PublicMenuItem | PublicBeansBlock> => {
        if (i.itemType === "beans") {
          const fields = i.beanFields ?? [...BEAN_MENU_FIELDS];
          return withFreezes.length ? [{ type: "beans", fields, beans: menuBeanList(withFreezes, fields, i.beanBatches ?? "each") }] : [];
        }
        // An archived brewer, or a source that's gone, is left off.
        if (!i.source || i.source.archived) return [];
        const id = (i.drinkId ?? i.brewerId ?? i.otherItemId)!;
        const parent = i.drinkId ? parentOf.get(i.drinkId) : null;
        return [
          {
            type: i.itemType,
            id,
            name: i.name ?? i.source.name,
            description: i.description ?? i.source.description,
            method: (i.showMethod ?? menu.showMethod) ? i.source.method : null, // an other item has none
            variantOf: (parent && menuNameOf.get(parent)) ?? null,
            ingredients: i.drinkId && (i.showIngredients ?? menu.showIngredients) ? ingredientRows.filter((r) => r.drinkId === i.drinkId).map((r) => r.name) : [],
            price: i.price,
            sizes: i.sizes,
            available: i.available,
          },
        ];
      }),
    }))
    .filter((s) => s.items.length > 0);

  return {
    title: menu.title ?? workspace.name,
    tagline: menu.tagline,
    accentColor: menu.accentColor,
    logoUrl: menu.logoId ? `/api/public/menu/${encodeURIComponent(workspace.slug)}/logo/${menu.logoId}` : null,
    workspace: { name: workspace.name, slug: workspace.slug }, currency: menu.currency, sections };
}
