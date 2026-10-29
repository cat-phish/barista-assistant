import { describe, expect, it } from 'vitest';
import type { StatsBean, StatsBrew } from '../api/types';
import { COLOR_BY, INPUTS, linearFit, RESULTS, strength, visible, type ExploreContext } from './explore';

const brew = (fields: Partial<StatsBrew> = {}): StatsBrew => ({
  id: 'b', timestamp: '2026-10-20T15:00:00.000Z', utcOffsetMinutes: null, userId: 'u', beanId: 'bean', recipeId: null, brewerId: null,
  methodId: null, styleId: null, brewsLike: null, grinderId: null, drinkId: null, toolIds: [], problemIds: [], doseGrams: 15,
  waterGrams: 250, iceGrams: null, yieldGrams: null, servingSize: null, servingUnit: null, drinkServingSize: null, drinkServingUnit: null,
  dilutionRatio: null, timeSec: 150, expectedFinishMinSec: null, expectedFinishMaxSec: null, grindSetting: null, tempC: null,
  tdsPercent: null, rating: null, drinkRating: null, ...fields,
});
const bean = { id: 'bean', roasterName: ' Onyx ', country: 'Kenya, Rwanda', processId: 'p1', roastLevel: 'light', altitudeMasl: 1800, roastDate: '2026-10-10T00:00:00.000Z', freezes: [] } as unknown as StatsBean;
const ctx: ExploreContext = {
  bean: (id) => (id === 'bean' ? bean : undefined),
  name: (id) => (id === 'p1' ? 'Washed' : null),
  volume: () => ({ ml: 300, source: 'measured' }),
  volumeIn: (ml) => ml,
  volumeLabel: 'ml',
};
const input = (key: string) => INPUTS.find((f) => f.key === key)!;
const result = (key: string) => RESULTS.find((f) => f.key === key)!;

describe('explore fields', () => {
  it('reads the brew and its bean', () => {
    const b = brew({ waterGrams: 200, iceGrams: 50, toolIds: ['wdt'] });
    expect(input('ratio').value(b, ctx)).toBe(16.7);
    expect(input('ratio').value(brew({ waterGrams: null, yieldGrams: 36, doseGrams: 18 }), ctx)).toBe(2);
    expect(input('roastAge').value(b, ctx)).toBe(10);
    expect(input('altitude').value(b, ctx)).toBe(1800);
    expect(input('country').value(b, ctx)).toEqual(['Kenya', 'Rwanda']);
    expect(input('roaster').value(b, ctx)).toBe('Onyx');
    expect(input('tool').value(b, ctx)).toEqual(['wdt']);
    expect(input('weekday').value(b, ctx)).toBe('Tue');
    const process = input('process');
    expect(process.kind === 'category' && process.name('p1', ctx)).toBe('Washed');
    expect(result('ey').value(brew({ tdsPercent: 1.4, yieldGrams: 220 }), ctx)).toBe(20.5);
    expect(result('volume').value(b, ctx)).toBe(300);
    expect(result('time').value(brew({ timeSec: 0 }), ctx)).toBeNull();
  });
  it('leaves out fields the workspace hides, and multi-valued ones from colour by', () => {
    const keys = visible(RESULTS, new Set(['brew.tds'])).map((f) => f.key);
    expect(keys).not.toContain('ey');
    expect(keys).not.toContain('tds');
    expect(visible(INPUTS, new Set(['brew.grinder'])).map((f) => f.key)).not.toContain('grinder');
    expect(COLOR_BY.map((f) => f.key)).not.toContain('tool');
    expect(COLOR_BY.map((f) => f.key)).toContain('grinder');
  });
});

describe('linearFit', () => {
  it('fits a line and gives r', () => {
    const fit = linearFit([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]);
    expect(fit).toEqual({ slope: 2, intercept: 0, r: 1, n: 3 });
    expect(linearFit([{ x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 1 }])?.r).toBeCloseTo(-1);
  });
  it('is null with too few points or no spread in x', () => {
    expect(linearFit([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBeNull();
    expect(linearFit([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }])).toBeNull();
  });
  it('puts r in words', () => {
    expect(strength(0.05)).toBe('no clear link');
    expect(strength(0.45)).toBe('a moderate positive link');
    expect(strength(-0.8)).toBe('a strong negative link');
  });
});
