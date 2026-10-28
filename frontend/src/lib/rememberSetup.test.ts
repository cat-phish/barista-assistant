import { describe, expect, it } from 'vitest';
import type { RememberKey } from '../api/types';
import { DEFAULT_PREFERENCES } from '../composables/usePreferences';
import { REMEMBER_OPTIONS, rememberedSize, rememberedTools, rememberKeyFor, storedSize, stillActive, storedTools } from './rememberSetup';

describe('REMEMBER_OPTIONS', () => {
  it('lists every setting once, and the defaults are among them', () => {
    const all: Record<RememberKey, true> = { what: true, brewer: true, recipe: true, bean: true, grinder: true, grind: true, waterProfile: true, prepTools: true, size: true };
    const keys = REMEMBER_OPTIONS.map((o) => o.key);
    expect([...keys].sort()).toEqual(Object.keys(all).sort());
    for (const k of DEFAULT_PREFERENCES.rememberSetup) expect(keys).toContain(k);
  });
});

describe('rememberKeyFor', () => {
  it('says which setting each stored choice follows', () => {
    expect(rememberKeyFor('brewWhat')).toBe('what');
    expect(rememberKeyFor('brewItem')).toBe('what');
    expect(rememberKeyFor('brewBrewer.espresso')).toBe('brewer');
    expect(rememberKeyFor('brewRecipe.v60')).toBe('recipe');
    expect(rememberKeyFor('beanId')).toBe('bean');
    expect(rememberKeyFor('grinderId')).toBe('grinder');
    expect(rememberKeyFor('waterProfileId')).toBe('waterProfile');
    expect(rememberKeyFor('prepTools.v60')).toBe('prepTools');
    expect(rememberKeyFor('size.latte')).toBe('size');
  });
  it('the Suggest parameters choices are always remembered', () => {
    expect(rememberKeyFor('suggestSource')).toBeNull();
    expect(rememberKeyFor('compareWith')).toBeNull();
    expect(rememberKeyFor('suggestMax')).toBeNull();
    expect(rememberKeyFor('suggestAlternatives')).toBeNull();
  });
});

describe('remembered values', () => {
  const list = [
    { id: 'a', archivedAt: null },
    { id: 'old', archivedAt: '2026-10-20T00:00:00.000Z' },
  ];
  it('an id only while it can still be picked', () => {
    expect(stillActive('a', list)).toBe('a');
    expect(stillActive('old', list)).toBeNull();
    expect(stillActive('gone', list)).toBeNull();
    expect(stillActive(null, list)).toBeNull();
  });
  it('prep tools: active ones only; nothing ticked is remembered too', () => {
    expect(rememberedTools(storedTools(['a', 'old', 'gone']), list)).toEqual(['a']);
    expect(rememberedTools(storedTools([]), list)).toEqual([]);
    expect(rememberedTools(null, list)).toBeNull();
  });
  it('drink size round-trips; anything else is ignored', () => {
    expect(rememberedSize(storedSize({ size: 12.5, unit: 'fl_oz' }))).toEqual({ size: 12.5, unit: 'fl_oz' });
    expect(rememberedSize(storedSize({ size: 350, unit: 'ml' }))).toEqual({ size: 350, unit: 'ml' });
    for (const bad of [null, '', '12', '12|cups', '0|ml', 'x|ml', '5000|ml']) expect(rememberedSize(bad), String(bad)).toBeNull();
  });
});
