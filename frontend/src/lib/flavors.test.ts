import { describe, expect, it } from 'vitest';
import { FLAVOR_LABELS, FLAVOR_WHEEL, flavorPlace, isFlavorKey, searchFlavors, segmentLabel, sortFlavors, wheelSegments, type FlavorKey } from './flavors';

// The shared list, read as text: the frontend doesn't import @barista/shared.
const shared = Object.values(import.meta.glob('../../../shared/src/flavors.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const sharedEntries = [...shared.slice(shared.indexOf('FLAVORS = {'), shared.indexOf('} as const')).matchAll(/^\s+"([\w.]+)": "([^"]+)",$/gm)].map((m) => [m[1], m[2]]);

describe('flavor wheel', () => {
  it('has the same keys and labels as the API, in the same order', () => {
    expect(sharedEntries.length).toBeGreaterThan(100);
    expect(Object.entries(FLAVOR_LABELS)).toEqual(sharedEntries);
  });

  it('lists every flavor after the ring it sits in', () => {
    const seen = new Set<string>();
    for (const key of Object.keys(FLAVOR_LABELS)) {
      const parent = key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : null;
      if (parent) expect(seen.has(parent), key).toBe(true);
      seen.add(key);
    }
    expect(FLAVOR_WHEEL.map((n) => n.key)).toEqual(['fruity', 'floral', 'sweet', 'nutty_cocoa', 'spice', 'roasted', 'sour_fermented', 'green', 'off']);
  });

  it('places and sorts picks', () => {
    expect(flavorPlace('fruity.berry.blueberry')).toBe('Fruity › Berry');
    expect(flavorPlace('fruity')).toBe('');
    expect(sortFlavors(['off.harsh.bitter', 'fruity', 'fruity.citrus.lemon'])).toEqual(['fruity', 'fruity.citrus.lemon', 'off.harsh.bitter']);
    expect(isFlavorKey('fruity.berry')).toBe(true);
    expect(isFlavorKey('fruity.banana')).toBe(false);
  });

  it('finds flavors by name, the outermost first', () => {
    expect(searchFlavors('berry').slice(0, 3)).toEqual(['fruity.berry.blackberry', 'fruity.berry.blueberry', 'fruity.berry.raspberry']);
    expect(searchFlavors('berry')).toContain('fruity.berry');
    expect(searchFlavors('  ')).toEqual([]);
  });

  it('fills the circle with the rings around the flavor zoomed into', () => {
    const whole = (segments: ReturnType<typeof wheelSegments>, ring: 1 | 2) =>
      segments.filter((s) => s.ring === ring).reduce((sum, s) => sum + (s.a1 - s.a0), 0);
    const root = wheelSegments(null);
    expect(whole(root, 1)).toBeCloseTo(2 * Math.PI);
    expect(root.filter((s) => s.ring === 1).map((s) => s.node.key)).toEqual(FLAVOR_WHEEL.map((n) => n.key));
    // A flavor with nothing further out reaches the edge.
    const roasted = wheelSegments('roasted');
    expect(roasted.find((s) => s.node.key === 'roasted.tobacco')).toMatchObject({ ring: 1, r1: 98 });
    // Zoomed into a group, its flavors are one ring to the edge.
    const berry = wheelSegments('fruity.berry');
    expect(berry.every((s) => s.ring === 1 && s.r1 === 98)).toBe(true);
    expect(berry.map((s) => s.node.key)).toEqual(['fruity.berry.blackberry', 'fruity.berry.blueberry', 'fruity.berry.raspberry', 'fruity.berry.strawberry', 'fruity.berry.blackcurrant']);
  });

  it('labels every segment readably at the top level and zoomed in', () => {
    for (const focus of [null, ...FLAVOR_WHEEL.map((n) => n.key), 'fruity.berry'] as Array<FlavorKey | null>) {
      for (const s of wheelSegments(focus)) {
        const label = segmentLabel(s);
        expect(label, `${focus} → ${s.node.key}`).not.toBeNull();
        expect(label!.rotate, s.node.key).toBeGreaterThanOrEqual(-90);
        expect(label!.rotate, s.node.key).toBeLessThanOrEqual(90);
      }
    }
  });
});
