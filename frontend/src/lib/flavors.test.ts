import { describe, expect, it } from 'vitest';
import type { FlavorLexicon } from '../api/types';
import { buildWheel, DEFAULT_LEXICON, DEFAULT_WHEEL, FLAVOR_COLORS, FLAVOR_LABELS, segmentCue, segmentLabel, wheelSegments } from './flavors';

// The shared lists, read as text: the frontend doesn't import @barista/shared.
const shared = Object.values(import.meta.glob('../../../shared/src/flavors.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const block = (start: string) => shared.slice(shared.indexOf(start), shared.indexOf('\n}', shared.indexOf(start)));
const sharedLabels = [...block('FLAVORS = {').matchAll(/^\s+"([\w.]+)": "([^"]+)",$/gm)].map((m) => [m[1], m[2]]);
const sharedColors = [...block('FLAVOR_COLORS: ').matchAll(/^\s+"([\w.]+)": "(#[0-9a-f]{6})",$/gm)].map((m) => [m[1], m[2]]);

const ours: FlavorLexicon = {
  format: 'barista-flavor-lexicon',
  version: 1,
  name: 'House wheel',
  flavors: [
    { key: 'bright', label: 'Bright', color: '#f2d64b' },
    { key: 'bright.citrus', label: 'Zesty' },
    { key: 'bright.citrus.yuzu', label: 'Yuzu' },
    { key: 'bright.floral', label: 'Floral', color: '#5b2a86' },
    { key: 'deep', label: 'Deep' },
  ],
};

describe('the built-in flavor wheel', () => {
  it('has the same keys, labels and colours as the API, in the same order', () => {
    expect(sharedLabels.length).toBeGreaterThan(100);
    expect(Object.entries(FLAVOR_LABELS)).toEqual(sharedLabels);
    expect(Object.entries(FLAVOR_COLORS)).toEqual(sharedColors);
  });

  it('places, sorts and finds flavors', () => {
    expect(DEFAULT_WHEEL.roots.map((n) => n.key)).toEqual(['fruity', 'floral', 'sweet', 'nutty_cocoa', 'spice', 'roasted', 'sour_fermented', 'green', 'off']);
    expect(DEFAULT_WHEEL.place('fruity.berry.blueberry')).toBe('Fruity › Berry');
    expect(DEFAULT_WHEEL.place('fruity')).toBe('');
    expect(DEFAULT_WHEEL.sort(['gone', 'off.harsh.bitter', 'fruity', 'fruity.citrus.lemon'])).toEqual(['fruity', 'fruity.citrus.lemon', 'off.harsh.bitter', 'gone']);
    expect(DEFAULT_WHEEL.search('berry').slice(0, 3)).toEqual(['fruity.berry.blackberry', 'fruity.berry.blueberry', 'fruity.berry.raspberry']);
    expect(DEFAULT_WHEEL.search('berry')).toContain('fruity.berry');
    expect(DEFAULT_WHEEL.search('  ')).toEqual([]);
  });

  it('fills the circle with the rings around the flavor zoomed into', () => {
    const whole = (segments: ReturnType<typeof wheelSegments>, ring: 1 | 2) => segments.filter((s) => s.ring === ring).reduce((sum, s) => sum + (s.a1 - s.a0), 0);
    const root = wheelSegments(DEFAULT_WHEEL, null);
    expect(whole(root, 1)).toBeCloseTo(2 * Math.PI);
    // A flavor with nothing further out reaches the edge.
    expect(wheelSegments(DEFAULT_WHEEL, 'roasted').find((s) => s.node.key === 'roasted.tobacco')).toMatchObject({ ring: 1, r1: 98 });
    const berry = wheelSegments(DEFAULT_WHEEL, 'fruity.berry');
    expect(berry.every((s) => s.ring === 1 && s.r1 === 98)).toBe(true);
    expect(berry).toHaveLength(5);
  });

  it('labels every segment readably, never upside down', () => {
    for (const focus of [null, ...DEFAULT_WHEEL.roots.map((n) => n.key), 'fruity.berry']) {
      for (const s of wheelSegments(DEFAULT_WHEEL, focus)) {
        const label = segmentLabel(s);
        expect(label, `${focus} → ${s.node.key}`).not.toBeNull();
        expect(label!.rotate).toBeGreaterThanOrEqual(-90);
        expect(label!.rotate).toBeLessThanOrEqual(90);
      }
    }
  });

  it('puts an arrow on segments that open and nothing on the rest', () => {
    const segments = wheelSegments(DEFAULT_WHEEL, null);
    expect(segmentCue(segments.find((s) => s.node.key === 'fruity.berry')!)).not.toBeNull();
    expect(segmentCue(segments.find((s) => s.node.key === 'roasted.tobacco')!)).toBeNull();
  });

  it('fits the arrow inside even the thinnest slice', () => {
    const rows = Array.from({ length: 60 }, (_, i) => [{ key: `one.f${i}`, label: `F${i}` }, { key: `one.f${i}.x`, label: 'X' }]).flat();
    const wheel = buildWheel({ ...DEFAULT_LEXICON, flavors: [{ key: 'one', label: 'One' }, ...rows] });
    for (const s of wheelSegments(wheel, null)) {
      const cue = segmentCue(s)!;
      expect(Math.hypot(cue.x, cue.y)).toBeGreaterThan(s.r0);
      expect(Math.hypot(cue.x, cue.y)).toBeLessThan(s.r1);
    }
  });

  it('keeps room for the arrow only where there is one', () => {
    const berry = wheelSegments(DEFAULT_WHEEL, null).find((s) => s.node.key === 'fruity.berry')!;
    const opens = segmentLabel(berry)!;
    const picks = segmentLabel({ ...berry, node: { ...berry.node, children: [] } })!;
    const middle = (berry.r0 + berry.r1) / 2;
    expect(Math.hypot(picks.x, picks.y)).toBeCloseTo(middle);
    expect(Math.hypot(opens.x, opens.y)).toBeLessThan(middle);
  });
});

describe('a workspace’s own wheel', () => {
  const wheel = buildWheel(ours);

  it('builds from its file, colouring what has no colour', () => {
    expect(wheel.name).toBe('House wheel');
    expect(wheel.roots.map((n) => [n.key, n.leaves])).toEqual([['bright', 2], ['deep', 1]]);
    expect(wheel.node('bright.citrus')!.color).toBe('#f5df73'); // a lighter shade of Bright
    expect(wheel.node('bright.floral')!.color).toBe('#5b2a86'); // its own
    expect(wheel.node('deep')!.color).toBe(DEFAULT_LEXICON.flavors.find((f) => f.key === 'floral')!.color); // the palette's second
    expect(wheel.place('bright.citrus.yuzu')).toBe('Bright › Zesty');
  });

  it('writes on each colour in whichever of dark or white reads', () => {
    expect(wheel.node('bright')!.ink).toBe('#1d1b1a'); // pale yellow
    expect(wheel.node('bright.floral')!.ink).toBe('#ffffff'); // deep purple
  });

  it('draws its rings', () => {
    expect(wheelSegments(wheel, null).map((s) => [s.node.key, s.ring])).toEqual([
      ['bright', 1],
      ['bright.citrus', 2],
      ['bright.floral', 2],
      ['deep', 1],
    ]);
    expect(wheelSegments(wheel, 'nope')).toEqual([]);
  });
});
