// The flavor wheel (docs/api/brew-logs.md §6, "flavors"): a lexicon of
// tasting descriptors, up to three rings deep. A key's dots give its place on
// the wheel ("fruity.berry.blueberry" sits under "fruity.berry", under
// "fruity"), and any ring can be picked.
//
// FLAVORS is the built-in wheel: our own, on the common tasting vocabulary
// (not the SCA/WCR artwork, whose licence doesn't fit this AGPL code). A
// workspace can replace it with its own lexicon file
// (docs/api/flavor-lexicon.md §2c, docs/custom-flavor-wheel.md), checked by
// parseLexicon below. Keys are stored on brews (brew_log_flavors, with the
// label at the time), so rename a label freely but never a key. The frontend
// keeps the same built-in list and colours (lib/flavors.ts, a test checks).
export const FLAVORS = {
  "fruity": "Fruity",
  "fruity.berry": "Berry",
  "fruity.berry.blackberry": "Blackberry",
  "fruity.berry.blueberry": "Blueberry",
  "fruity.berry.raspberry": "Raspberry",
  "fruity.berry.strawberry": "Strawberry",
  "fruity.berry.blackcurrant": "Blackcurrant",
  "fruity.citrus": "Citrus",
  "fruity.citrus.lemon": "Lemon",
  "fruity.citrus.lime": "Lime",
  "fruity.citrus.orange": "Orange",
  "fruity.citrus.grapefruit": "Grapefruit",
  "fruity.citrus.bergamot": "Bergamot",
  "fruity.stone": "Stone fruit",
  "fruity.stone.cherry": "Cherry",
  "fruity.stone.peach": "Peach",
  "fruity.stone.apricot": "Apricot",
  "fruity.stone.plum": "Plum",
  "fruity.orchard": "Orchard fruit",
  "fruity.orchard.apple": "Apple",
  "fruity.orchard.pear": "Pear",
  "fruity.orchard.grape": "Grape",
  "fruity.tropical": "Tropical",
  "fruity.tropical.mango": "Mango",
  "fruity.tropical.pineapple": "Pineapple",
  "fruity.tropical.passion_fruit": "Passion fruit",
  "fruity.tropical.papaya": "Papaya",
  "fruity.dried": "Dried fruit",
  "fruity.dried.raisin": "Raisin",
  "fruity.dried.prune": "Prune",
  "fruity.dried.date": "Date",
  "fruity.dried.fig": "Fig",
  "floral": "Floral",
  "floral.flowers": "Flowers",
  "floral.flowers.jasmine": "Jasmine",
  "floral.flowers.rose": "Rose",
  "floral.flowers.orange_blossom": "Orange blossom",
  "floral.flowers.lavender": "Lavender",
  "floral.flowers.hibiscus": "Hibiscus",
  "floral.tea": "Tea-like",
  "floral.tea.black_tea": "Black tea",
  "floral.tea.green_tea": "Green tea",
  "floral.tea.chamomile": "Chamomile",
  "sweet": "Sweet",
  "sweet.caramelized": "Caramelized",
  "sweet.caramelized.caramel": "Caramel",
  "sweet.caramelized.toffee": "Toffee",
  "sweet.caramelized.brown_sugar": "Brown sugar",
  "sweet.caramelized.molasses": "Molasses",
  "sweet.syrupy": "Syrupy",
  "sweet.syrupy.honey": "Honey",
  "sweet.syrupy.maple": "Maple syrup",
  "sweet.syrupy.vanilla": "Vanilla",
  "sweet.syrupy.marshmallow": "Marshmallow",
  "nutty_cocoa": "Nutty & cocoa",
  "nutty_cocoa.nutty": "Nutty",
  "nutty_cocoa.nutty.almond": "Almond",
  "nutty_cocoa.nutty.hazelnut": "Hazelnut",
  "nutty_cocoa.nutty.peanut": "Peanut",
  "nutty_cocoa.nutty.walnut": "Walnut",
  "nutty_cocoa.cocoa": "Cocoa",
  "nutty_cocoa.cocoa.milk_chocolate": "Milk chocolate",
  "nutty_cocoa.cocoa.dark_chocolate": "Dark chocolate",
  "nutty_cocoa.cocoa.cocoa_powder": "Cocoa powder",
  "spice": "Spice",
  "spice.warm": "Warm spice",
  "spice.warm.cinnamon": "Cinnamon",
  "spice.warm.nutmeg": "Nutmeg",
  "spice.warm.clove": "Clove",
  "spice.warm.cardamom": "Cardamom",
  "spice.warm.anise": "Anise",
  "spice.pungent": "Pungent",
  "spice.pungent.black_pepper": "Black pepper",
  "spice.pungent.ginger": "Ginger",
  "roasted": "Roasted",
  "roasted.cereal": "Cereal",
  "roasted.cereal.grain": "Grain",
  "roasted.cereal.malt": "Malt",
  "roasted.cereal.toast": "Toast",
  "roasted.cereal.biscuit": "Biscuit",
  "roasted.dark": "Dark roast",
  "roasted.dark.smoky": "Smoky",
  "roasted.dark.ashy": "Ashy",
  "roasted.dark.burnt": "Burnt",
  "roasted.tobacco": "Tobacco",
  "sour_fermented": "Sour & fermented",
  "sour_fermented.sour": "Sour",
  "sour_fermented.sour.tart": "Tart",
  "sour_fermented.sour.vinegar": "Vinegar",
  "sour_fermented.sour.sour_milk": "Sour milk",
  "sour_fermented.fermented": "Fermented",
  "sour_fermented.fermented.winey": "Winey",
  "sour_fermented.fermented.boozy": "Boozy",
  "sour_fermented.fermented.overripe": "Overripe",
  "green": "Green & vegetal",
  "green.fresh": "Fresh",
  "green.fresh.grassy": "Grassy",
  "green.fresh.herbal": "Herbal",
  "green.fresh.pea_pod": "Pea pod",
  "green.dry": "Dry",
  "green.dry.hay": "Hay",
  "green.dry.straw": "Straw",
  "green.dry.woody": "Woody",
  "green.underripe": "Underripe",
  "off": "Off flavors",
  "off.stale": "Stale",
  "off.stale.papery": "Papery",
  "off.stale.cardboard": "Cardboard",
  "off.stale.flat": "Flat",
  "off.musty": "Musty",
  "off.musty.earthy": "Earthy",
  "off.musty.damp": "Damp",
  "off.musty.mouldy": "Mouldy",
  "off.chemical": "Chemical",
  "off.chemical.rubber": "Rubber",
  "off.chemical.medicinal": "Medicinal",
  "off.chemical.petroleum": "Petroleum",
  "off.harsh": "Harsh",
  "off.harsh.bitter": "Bitter",
  "off.harsh.astringent": "Astringent",
  "off.harsh.salty": "Salty",
} as const;
export type FlavorKey = keyof typeof FLAVORS;
export const FLAVOR_KEYS = Object.keys(FLAVORS) as FlavorKey[];

// The built-in wheel's colours, one per inner-ring flavor; its outer rings
// are lighter shades.
export const FLAVOR_COLORS: Readonly<Record<string, string>> = {
  "fruity": "#d0453f",
  "floral": "#b86aa6",
  "sweet": "#d98b2b",
  "nutty_cocoa": "#94603a",
  "spice": "#b4512c",
  "roasted": "#6b4c3b",
  "sour_fermented": "#b9a12e",
  "green": "#5f9343",
  "off": "#7b8794",
};

// ---- Lexicon files -----------------------------------------------------------

// A wheel as a file (docs/custom-flavor-wheel.md): the built-in one as a
// download, or a workspace's own. Flavors in wheel order, each after the
// flavor it sits under.
export const LEXICON_FORMAT = "barista-flavor-lexicon";
export const LEXICON_VERSION = 1;
export const LEXICON_LIMITS = { flavors: 500, depth: 3, key: 64, label: 60, name: 100 } as const;
export const LEXICON_KEY = /^[a-z0-9_]+(\.[a-z0-9_]+){0,2}$/;
export const LEXICON_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface LexiconFlavor {
  key: string;
  label: string;
  color?: string; // #rrggbb; without one, the nearest colour further in, lighter
}
export interface FlavorLexicon {
  format: typeof LEXICON_FORMAT;
  version: typeof LEXICON_VERSION;
  name: string;
  flavors: LexiconFlavor[];
}

export const DEFAULT_LEXICON: FlavorLexicon = {
  format: LEXICON_FORMAT,
  version: LEXICON_VERSION,
  name: "Built-in wheel",
  flavors: FLAVOR_KEYS.map((key) => (FLAVOR_COLORS[key] ? { key, label: FLAVORS[key], color: FLAVOR_COLORS[key] } : { key, label: FLAVORS[key] })),
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// Checks a lexicon file, with the first problem as "flavors[3].key: …".
// Text is trimmed; fields it doesn't know are ignored and not kept.
export function parseLexicon(input: unknown): { ok: true; lexicon: FlavorLexicon } | { ok: false; error: string } {
  if (!isObject(input) || input.format !== LEXICON_FORMAT) return { ok: false, error: `format: must be "${LEXICON_FORMAT}"` };
  if (typeof input.version !== "number" || !Number.isInteger(input.version) || input.version < 1) return { ok: false, error: "version: must be 1" };
  if (input.version > LEXICON_VERSION) return { ok: false, error: "version: made for a newer version of the app" };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > LEXICON_LIMITS.name) return { ok: false, error: `name: 1–${LEXICON_LIMITS.name} characters` };
  if (!Array.isArray(input.flavors) || input.flavors.length === 0) return { ok: false, error: "flavors: must be a list with at least one flavor" };
  if (input.flavors.length > LEXICON_LIMITS.flavors) return { ok: false, error: `flavors: at most ${LEXICON_LIMITS.flavors}` };
  const seen = new Set<string>();
  const flavors: LexiconFlavor[] = [];
  for (const [i, raw] of input.flavors.entries()) {
    const at = `flavors[${i}]`;
    if (!isObject(raw)) return { ok: false, error: `${at}: must be an object` };
    const key = raw.key;
    if (typeof key !== "string" || key.length > LEXICON_LIMITS.key || !LEXICON_KEY.test(key)) {
      return { ok: false, error: `${at}.key: lowercase letters, digits and _, up to three parts joined by dots, at most ${LEXICON_LIMITS.key} characters` };
    }
    if (seen.has(key)) return { ok: false, error: `${at}.key: "${key}" is listed twice` };
    const parent = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : null;
    if (parent && !seen.has(parent)) return { ok: false, error: `${at}.key: "${parent}" must be listed before "${key}"` };
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (!label || label.length > LEXICON_LIMITS.label) return { ok: false, error: `${at}.label: 1–${LEXICON_LIMITS.label} characters` };
    if (raw.color !== undefined && raw.color !== null && (typeof raw.color !== "string" || !LEXICON_COLOR.test(raw.color))) {
      return { ok: false, error: `${at}.color: must look like #a1b2c3` };
    }
    seen.add(key);
    flavors.push(typeof raw.color === "string" ? { key, label, color: raw.color.toLowerCase() } : { key, label });
  }
  return { ok: true, lexicon: { format: LEXICON_FORMAT, version: LEXICON_VERSION, name, flavors } };
}

// ---- Reading picks -------------------------------------------------------------

// A pick as stored: its key and the label it had when picked.
export interface FlavorPick {
  key: string;
  label: string;
  place?: string | null; // the rings above it when picked (flavorPlace)
}

// Picks in the lexicon's wheel order (ones it no longer has last, as
// stored), each with its label now: the lexicon's, else the saved one.
export function resolvePicks(lexicon: FlavorLexicon, picks: readonly FlavorPick[]): FlavorPick[] {
  const order = new Map(lexicon.flavors.map((f, i) => [f.key, i] as const));
  const labels = new Map(lexicon.flavors.map((f) => [f.key, f.label] as const));
  return [...picks]
    .map((p, i) => ({ p, at: order.get(p.key) ?? lexicon.flavors.length + i }))
    .sort((a, b) => a.at - b.at)
    .map(({ p }) => ({ ...p, label: labels.get(p.key) ?? p.label }));
}

// The rings above a flavor, innermost first: "Fruity › Berry"; null on the
// inner ring or off this lexicon. A ring repeating the name next to it says
// nothing, so it's left out: "Rose" under "Floral › Floral" is "Floral".
export function flavorPlace(lexicon: FlavorLexicon, key: string): string | null {
  const labels = new Map(lexicon.flavors.map((f) => [f.key, f.label] as const));
  const label = labels.get(key);
  if (label === undefined) return null;
  const parts = key.split(".");
  const rings = parts.slice(0, -1).map((_, i) => labels.get(parts.slice(0, i + 1).join(".")) ?? parts[i]!);
  const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
  const above = rings.filter((ring, i) => !same(rings[i + 1] ?? label, ring));
  return above.length ? above.join(" › ") : null;
}

// How the AI reads a pick: its label with the rings above it, e.g.
// "Blueberry (Fruity › Berry)". A flavor the lexicon no longer has keeps the
// place saved with it. Picks from before places were saved look theirs up on
// the built-in wheel, the only one with those keys, if the label still agrees
// (a custom wheel could have used the same key for something else).
export function flavorLabel(lexicon: FlavorLexicon, pick: FlavorPick): string {
  const onWheel = lexicon.flavors.find((f) => f.key === pick.key);
  const builtIn = DEFAULT_LEXICON.flavors.find((f) => f.key === pick.key);
  const place = onWheel
    ? flavorPlace(lexicon, pick.key)
    : (pick.place ?? (builtIn?.label === pick.label ? flavorPlace(DEFAULT_LEXICON, pick.key) : null));
  const label = onWheel?.label ?? pick.label;
  return place ? `${label} (${place})` : label;
}
