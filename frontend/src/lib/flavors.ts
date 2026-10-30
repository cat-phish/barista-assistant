// The flavor wheel (docs/api/brew-logs.md §6, "flavors"): the same keys and
// labels as FLAVORS in @barista/shared/flavors (flavors.test.ts checks), plus
// how the wheel draws them. A key's dots give its place: "fruity.berry" sits
// under "fruity". Our own wheel and colours, not the SCA/WCR artwork.
export const FLAVOR_LABELS = {
  'fruity': 'Fruity',
  'fruity.berry': 'Berry',
  'fruity.berry.blackberry': 'Blackberry',
  'fruity.berry.blueberry': 'Blueberry',
  'fruity.berry.raspberry': 'Raspberry',
  'fruity.berry.strawberry': 'Strawberry',
  'fruity.berry.blackcurrant': 'Blackcurrant',
  'fruity.citrus': 'Citrus',
  'fruity.citrus.lemon': 'Lemon',
  'fruity.citrus.lime': 'Lime',
  'fruity.citrus.orange': 'Orange',
  'fruity.citrus.grapefruit': 'Grapefruit',
  'fruity.citrus.bergamot': 'Bergamot',
  'fruity.stone': 'Stone fruit',
  'fruity.stone.cherry': 'Cherry',
  'fruity.stone.peach': 'Peach',
  'fruity.stone.apricot': 'Apricot',
  'fruity.stone.plum': 'Plum',
  'fruity.orchard': 'Orchard fruit',
  'fruity.orchard.apple': 'Apple',
  'fruity.orchard.pear': 'Pear',
  'fruity.orchard.grape': 'Grape',
  'fruity.tropical': 'Tropical',
  'fruity.tropical.mango': 'Mango',
  'fruity.tropical.pineapple': 'Pineapple',
  'fruity.tropical.passion_fruit': 'Passion fruit',
  'fruity.tropical.papaya': 'Papaya',
  'fruity.dried': 'Dried fruit',
  'fruity.dried.raisin': 'Raisin',
  'fruity.dried.prune': 'Prune',
  'fruity.dried.date': 'Date',
  'fruity.dried.fig': 'Fig',
  'floral': 'Floral',
  'floral.flowers': 'Flowers',
  'floral.flowers.jasmine': 'Jasmine',
  'floral.flowers.rose': 'Rose',
  'floral.flowers.orange_blossom': 'Orange blossom',
  'floral.flowers.lavender': 'Lavender',
  'floral.flowers.hibiscus': 'Hibiscus',
  'floral.tea': 'Tea-like',
  'floral.tea.black_tea': 'Black tea',
  'floral.tea.green_tea': 'Green tea',
  'floral.tea.chamomile': 'Chamomile',
  'sweet': 'Sweet',
  'sweet.caramelized': 'Caramelized',
  'sweet.caramelized.caramel': 'Caramel',
  'sweet.caramelized.toffee': 'Toffee',
  'sweet.caramelized.brown_sugar': 'Brown sugar',
  'sweet.caramelized.molasses': 'Molasses',
  'sweet.syrupy': 'Syrupy',
  'sweet.syrupy.honey': 'Honey',
  'sweet.syrupy.maple': 'Maple syrup',
  'sweet.syrupy.vanilla': 'Vanilla',
  'sweet.syrupy.marshmallow': 'Marshmallow',
  'nutty_cocoa': 'Nutty & cocoa',
  'nutty_cocoa.nutty': 'Nutty',
  'nutty_cocoa.nutty.almond': 'Almond',
  'nutty_cocoa.nutty.hazelnut': 'Hazelnut',
  'nutty_cocoa.nutty.peanut': 'Peanut',
  'nutty_cocoa.nutty.walnut': 'Walnut',
  'nutty_cocoa.cocoa': 'Cocoa',
  'nutty_cocoa.cocoa.milk_chocolate': 'Milk chocolate',
  'nutty_cocoa.cocoa.dark_chocolate': 'Dark chocolate',
  'nutty_cocoa.cocoa.cocoa_powder': 'Cocoa powder',
  'spice': 'Spice',
  'spice.warm': 'Warm spice',
  'spice.warm.cinnamon': 'Cinnamon',
  'spice.warm.nutmeg': 'Nutmeg',
  'spice.warm.clove': 'Clove',
  'spice.warm.cardamom': 'Cardamom',
  'spice.warm.anise': 'Anise',
  'spice.pungent': 'Pungent',
  'spice.pungent.black_pepper': 'Black pepper',
  'spice.pungent.ginger': 'Ginger',
  'roasted': 'Roasted',
  'roasted.cereal': 'Cereal',
  'roasted.cereal.grain': 'Grain',
  'roasted.cereal.malt': 'Malt',
  'roasted.cereal.toast': 'Toast',
  'roasted.cereal.biscuit': 'Biscuit',
  'roasted.dark': 'Dark roast',
  'roasted.dark.smoky': 'Smoky',
  'roasted.dark.ashy': 'Ashy',
  'roasted.dark.burnt': 'Burnt',
  'roasted.tobacco': 'Tobacco',
  'sour_fermented': 'Sour & fermented',
  'sour_fermented.sour': 'Sour',
  'sour_fermented.sour.tart': 'Tart',
  'sour_fermented.sour.vinegar': 'Vinegar',
  'sour_fermented.sour.sour_milk': 'Sour milk',
  'sour_fermented.fermented': 'Fermented',
  'sour_fermented.fermented.winey': 'Winey',
  'sour_fermented.fermented.boozy': 'Boozy',
  'sour_fermented.fermented.overripe': 'Overripe',
  'green': 'Green & vegetal',
  'green.fresh': 'Fresh',
  'green.fresh.grassy': 'Grassy',
  'green.fresh.herbal': 'Herbal',
  'green.fresh.pea_pod': 'Pea pod',
  'green.dry': 'Dry',
  'green.dry.hay': 'Hay',
  'green.dry.straw': 'Straw',
  'green.dry.woody': 'Woody',
  'green.underripe': 'Underripe',
  'off': 'Off flavors',
  'off.stale': 'Stale',
  'off.stale.papery': 'Papery',
  'off.stale.cardboard': 'Cardboard',
  'off.stale.flat': 'Flat',
  'off.musty': 'Musty',
  'off.musty.earthy': 'Earthy',
  'off.musty.damp': 'Damp',
  'off.musty.mouldy': 'Mouldy',
  'off.chemical': 'Chemical',
  'off.chemical.rubber': 'Rubber',
  'off.chemical.medicinal': 'Medicinal',
  'off.chemical.petroleum': 'Petroleum',
  'off.harsh': 'Harsh',
  'off.harsh.bitter': 'Bitter',
  'off.harsh.astringent': 'Astringent',
  'off.harsh.salty': 'Salty',
} as const;
export type FlavorKey = keyof typeof FLAVOR_LABELS;

export interface FlavorNode {
  key: FlavorKey;
  label: string;
  depth: number; // 0 = inner ring
  children: FlavorNode[];
  leaves: number; // outermost descendants (itself if none): its share of the wheel
}

// Each category's colour; its rings are lighter shades of it.
const CATEGORY_COLORS: Record<string, string> = {
  fruity: '#d0453f',
  floral: '#b86aa6',
  sweet: '#d98b2b',
  nutty_cocoa: '#94603a',
  spice: '#b4512c',
  roasted: '#6b4c3b',
  sour_fermented: '#b9a12e',
  green: '#5f9343',
  off: '#7b8794',
};

export const isFlavorKey = (key: string): key is FlavorKey => Object.hasOwn(FLAVOR_LABELS, key);
const parentKey = (key: string): string | null => (key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : null);

function build(): FlavorNode[] {
  const nodes = new Map<string, FlavorNode>();
  const roots: FlavorNode[] = [];
  for (const [key, label] of Object.entries(FLAVOR_LABELS) as Array<[FlavorKey, string]>) {
    const node: FlavorNode = { key, label, depth: key.split('.').length - 1, children: [], leaves: 0 };
    nodes.set(key, node);
    const parent = parentKey(key);
    if (parent) nodes.get(parent)!.children.push(node);
    else roots.push(node);
  }
  const count = (n: FlavorNode): number => (n.leaves = n.children.length ? n.children.reduce((sum, c) => sum + count(c), 0) : 1);
  roots.forEach(count);
  return roots;
}

export const FLAVOR_WHEEL: readonly FlavorNode[] = build();
const BY_KEY = new Map<string, FlavorNode>();
const index = (n: FlavorNode) => {
  BY_KEY.set(n.key, n);
  n.children.forEach(index);
};
FLAVOR_WHEEL.forEach(index);
const ORDER = new Map((Object.keys(FLAVOR_LABELS) as FlavorKey[]).map((key, i) => [key, i]));

export const flavorNode = (key: FlavorKey): FlavorNode => BY_KEY.get(key)!;

// The rings above a flavor, innermost first: "fruity.berry.blueberry" →
// [Fruity, Berry].
export function flavorPath(key: FlavorKey): FlavorNode[] {
  const path: FlavorNode[] = [];
  for (let k = parentKey(key); k; k = parentKey(k)) path.unshift(BY_KEY.get(k)!);
  return path;
}

// "Fruity › Berry", for a chip's title and the list view.
export const flavorPlace = (key: FlavorKey): string => flavorPath(key).map((n) => n.label).join(' › ');

// Wheel order, whatever order they were picked in (as the API returns them).
export const sortFlavors = (keys: readonly FlavorKey[]): FlavorKey[] => [...keys].sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);

// A flavor's colour: its category's, lighter on each ring further out.
export function flavorColor(key: FlavorKey): string {
  const depth = key.split('.').length - 1;
  const base = CATEGORY_COLORS[key.split('.')[0]!] ?? '#888888';
  return depth === 0 ? base : `color-mix(in srgb, ${base} ${100 - depth * 22}%, white)`;
}

// Flavors whose label matches the search, outer rings
// first so "berry" finds the berries before Berry itself.
export function searchFlavors(query: string): FlavorKey[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = (Object.keys(FLAVOR_LABELS) as FlavorKey[]).filter((key) => FLAVOR_LABELS[key].toLowerCase().includes(q));
  return hits.sort((a, b) => b.split('.').length - a.split('.').length || ORDER.get(a)! - ORDER.get(b)!);
}

// ---- The wheel's geometry (components/FlavorWheel.vue) ----------------------

// Radii in the wheel's viewBox (-100…100): the centre circle (the flavor
// zoomed into, tap to pick it), then two rings.
export const WHEEL_RADII = { center: 26, mid: 62, outer: 98 } as const;

export interface WheelSegment {
  node: FlavorNode;
  ring: 1 | 2;
  a0: number; // radians clockwise from 12 o'clock
  a1: number;
  r0: number;
  r1: number;
}

// The two rings around the centre: focus's children (the categories when
// null) and their children, each sized by how many outer flavors it holds.
// A segment with nothing further out reaches the edge.
export function wheelSegments(focus: FlavorKey | null): WheelSegment[] {
  const { center, mid, outer } = WHEEL_RADII;
  const top = focus ? flavorNode(focus).children : FLAVOR_WHEEL;
  const total = top.reduce((sum, n) => sum + n.leaves, 0);
  const segments: WheelSegment[] = [];
  let a = 0;
  for (const node of top) {
    const span = (node.leaves / total) * 2 * Math.PI;
    segments.push({ node, ring: 1, a0: a, a1: a + span, r0: center, r1: node.children.length ? mid : outer });
    let b = a;
    for (const child of node.children) {
      const share = (child.leaves / node.leaves) * span;
      segments.push({ node: child, ring: 2, a0: b, a1: b + share, r0: mid, r1: outer });
      b += share;
    }
    a += span;
  }
  return segments;
}

const point = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;

// The SVG path of a ring segment.
export function segmentPath({ a0, a1, r0, r1 }: Pick<WheelSegment, 'a0' | 'a1' | 'r0' | 'r1'>): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${point(r0, a0)} L ${point(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${point(r1, a1)} L ${point(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${point(r0, a0)} Z`;
}

export interface SegmentLabel {
  x: number;
  y: number;
  rotate: number; // degrees (−90…90), along the radius and never upside down
  size: number; // font size in viewBox units
  lines: string[];
}

// A label along the segment's radius, on one line or split in two, as big as
// fits (at most 7 units); null when the segment is too thin to read.
export function segmentLabel(s: WheelSegment): SegmentLabel | null {
  const label = s.node.label;
  const space = label.indexOf(' ', Math.floor(label.length / 2) - 3);
  const lines = label.length > 9 && space > 0 ? [label.slice(0, space), label.slice(space + 1)] : [label];
  const longest = Math.max(...lines.map((l) => l.length));
  const mid = (s.a0 + s.a1) / 2;
  const r = (s.r0 + s.r1) / 2;
  const across = r * (s.a1 - s.a0); // room across the radius, at the middle
  const size = Math.min(7, (s.r1 - s.r0 - 4) / (longest * 0.56), (across * 0.8) / (lines.length * 1.15));
  if (size < 3.2) return null;
  const deg = (mid * 180) / Math.PI;
  return { x: r * Math.sin(mid), y: -r * Math.cos(mid), rotate: deg < 180 ? deg - 90 : deg - 270, size, lines };
}
