// The flavor wheel (docs/api/brew-logs.md §6, "flavors"), built from a
// lexicon: the workspace's own (docs/api/flavor-lexicon.md §2c) or the
// built-in one below. A key's dots give its place: "fruity.berry" sits under
// "fruity". The built-in list has the same keys, labels and colours as
// FLAVORS / FLAVOR_COLORS in @barista/shared/flavors (flavors.test.ts checks).
import type { FlavorLexicon } from '../api/types';

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

// The built-in wheel's colours, one per inner-ring flavor.
export const FLAVOR_COLORS: Readonly<Record<string, string>> = {
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

export const DEFAULT_LEXICON: FlavorLexicon = {
  format: 'barista-flavor-lexicon',
  version: 1,
  name: 'Built-in wheel',
  flavors: Object.entries(FLAVOR_LABELS).map(([key, label]) => (FLAVOR_COLORS[key] ? { key, label, color: FLAVOR_COLORS[key] } : { key, label })),
};

export interface FlavorNode {
  key: string;
  label: string;
  depth: number; // 0 = inner ring
  color: string; // #rrggbb: its own, else the nearest one further in, lighter
  ink: string; // text on it: dark or white, whichever reads
  children: FlavorNode[];
  leaves: number; // outermost descendants (itself if none): its share of the wheel
}

export interface Wheel {
  name: string;
  roots: FlavorNode[];
  node: (key: string) => FlavorNode | undefined;
  path: (key: string) => FlavorNode[]; // the rings above it, innermost first
  place: (key: string) => string; // "Fruity › Berry"
  sort: (keys: readonly string[]) => string[]; // wheel order; keys it doesn't have last
  search: (query: string) => string[];
}

const parentKey = (key: string): string | null => (key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : null);

// Colours for inner-ring flavors a lexicon leaves without one.
const PALETTE = Object.values(FLAVOR_COLORS);
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// Mixed with white: share 0 = the colour, 1 = white.
function lighten(hex: string, share: number): string {
  return '#' + channels(hex).map((c) => Math.round(c + (255 - c) * share).toString(16).padStart(2, '0')).join('');
}
// Dark text unless the colour is dark (WCAG relative luminance).
function inkFor(hex: string): string {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance > 0.22 ? '#1d1b1a' : '#ffffff';
}

export function buildWheel(lexicon: FlavorLexicon): Wheel {
  const nodes = new Map<string, FlavorNode>();
  const roots: FlavorNode[] = [];
  for (const f of lexicon.flavors) {
    const parent = parentKey(f.key);
    const above = parent ? nodes.get(parent) : undefined;
    const depth = f.key.split('.').length - 1;
    const color = f.color ?? (above ? lighten(above.color, 0.22) : PALETTE[roots.length % PALETTE.length]!);
    const node: FlavorNode = { key: f.key, label: f.label, depth, color, ink: inkFor(color), children: [], leaves: 0 };
    nodes.set(f.key, node);
    if (above) above.children.push(node);
    else roots.push(node);
  }
  const count = (n: FlavorNode): number => (n.leaves = n.children.length ? n.children.reduce((sum, c) => sum + count(c), 0) : 1);
  roots.forEach(count);
  const order = new Map(lexicon.flavors.map((f, i) => [f.key, i]));
  const path = (key: string): FlavorNode[] => {
    const out: FlavorNode[] = [];
    for (let k = parentKey(key); k; k = parentKey(k)) {
      const n = nodes.get(k);
      if (n) out.unshift(n);
    }
    return out;
  };
  return {
    name: lexicon.name,
    roots,
    node: (key) => nodes.get(key),
    path,
    place: (key) => (nodes.has(key) ? path(key).map((n) => n.label).join(' › ') : ''),
    sort: (keys) => [...keys].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity)),
    // Flavors whose label matches, outer rings first so "berry" finds the
    // berries before Berry itself.
    search: (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const hits = lexicon.flavors.filter((f) => f.label.toLowerCase().includes(q)).map((f) => f.key);
      return hits.sort((a, b) => b.split('.').length - a.split('.').length || order.get(a)! - order.get(b)!);
    },
  };
}

export const DEFAULT_WHEEL: Wheel = buildWheel(DEFAULT_LEXICON);

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

// The two rings around the centre: focus's children (the inner ring when
// null) and their children, each sized by how many outer flavors it holds.
// A segment with nothing further out reaches the edge.
export function wheelSegments(wheel: Wheel, focus: string | null): WheelSegment[] {
  const { center, mid, outer } = WHEEL_RADII;
  const top = focus ? (wheel.node(focus)?.children ?? []) : wheel.roots;
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

// The arrow at the outer edge of a segment that opens (it has flavors further
// out); a segment without one is picked straight away.
export interface SegmentCue {
  x: number;
  y: number;
  rotate: number; // degrees; 0 points at 12 o'clock
}

// Room kept clear for the arrow at a segment's outer edge.
const CUE_ROOM = 4;

export function segmentCue(s: WheelSegment): SegmentCue | null {
  if (!s.node.children.length) return null;
  const mid = (s.a0 + s.a1) / 2;
  const r = s.r1 - CUE_ROOM / 2;
  return { x: r * Math.sin(mid), y: -r * Math.cos(mid), rotate: (mid * 180) / Math.PI };
}

// A label along the segment's radius, on one line or split in two, as big as
// fits (at most 7 units) beside any arrow; null when the segment is too thin
// to read.
export function segmentLabel(s: WheelSegment): SegmentLabel | null {
  const label = s.node.label;
  const space = label.indexOf(' ', Math.floor(label.length / 2) - 3);
  const lines = label.length > 9 && space > 0 ? [label.slice(0, space), label.slice(space + 1)] : [label];
  const longest = Math.max(...lines.map((l) => l.length));
  const mid = (s.a0 + s.a1) / 2;
  const cueRoom = s.node.children.length ? CUE_ROOM : 0;
  const r = (s.r0 + s.r1 - cueRoom) / 2;
  const across = r * (s.a1 - s.a0); // room across the radius, at the middle
  const size = Math.min(7, (s.r1 - s.r0 - cueRoom - 4) / (longest * 0.56), (across * 0.8) / (lines.length * 1.15));
  if (size < 3.2) return null;
  const deg = (mid * 180) / Math.PI;
  return { x: r * Math.sin(mid), y: -r * Math.cos(mid), rotate: deg < 180 ? deg - 90 : deg - 270, size, lines };
}
