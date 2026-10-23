import { describe, expect, it } from 'vitest';
import type { Bean, BrewLog, Brewer, Drink, Grinder, Recipe, WaterProfile } from '../api/types';
import { madeKey, recentByMade, repeatLabel, repeatPlan, type RepeatSources } from './repeatBrew';

const log = (over: Partial<BrewLog> = {}): BrewLog =>
  ({
    id: 'l1', beanId: 'guji3', bean: { id: 'guji3', roasterName: 'Home', beanName: 'Guji', batchNumber: '3' },
    timestamp: '2026-10-21T08:00:00.000Z', brewerId: 'v60', brewer: { id: 'v60', name: 'V60', kind: 'filter' },
    recipeId: 'house', recipe: { id: 'house', name: 'House V60' }, drinkId: null, drink: null,
    grinderId: 'c40', grinder: { id: 'c40', name: 'C40' }, waterProfileId: 'tww', waterProfile: { id: 'tww', name: 'TWW' },
    ...over,
  }) as BrewLog;
const bean = (id: string, batchNumber: string | null, createdAt: string) =>
  ({ id, roasterName: 'Home', beanName: 'Guji', batchNumber, createdAt }) as Bean;
const sources = (over: Partial<RepeatSources> = {}): RepeatSources => ({
  beans: [bean('guji3', '3', '2026-10-01')],
  brewers: [
    { id: 'v60', name: 'V60', kind: 'filter', methodId: 'pour', archivedAt: null },
    { id: 'lm', name: 'Linea', kind: 'espresso', methodId: null, archivedAt: null },
  ] as Brewer[],
  drinks: [{ id: 'latte', name: 'Latte', kind: 'espresso', category: { id: 'milk', name: 'Milk' }, archivedAt: null }] as Drink[],
  recipes: [{ id: 'house', brewer: { id: 'v60' }, archivedAt: null }] as Recipe[],
  grinders: [{ id: 'c40', archivedAt: null }] as Grinder[],
  waterProfiles: [{ id: 'tww', archivedAt: null }] as WaterProfile[],
  ...over,
});

describe('repeatPlan', () => {
  it('a plain brew: its method, brewer, recipe, grinder and water', () => {
    expect(repeatPlan(log(), sources())).toEqual({
      beanId: 'guji3', what: 'method:pour', item: 'plain:pour', brewerId: 'v60', recipeId: 'house',
      grinderId: 'c40', waterProfileId: 'tww', missing: [],
    });
  });
  it("a drink: its category and the drink, on the log's brewer", () => {
    const p = repeatPlan(log({ brewerId: 'lm', brewer: { id: 'lm', name: 'Linea', kind: 'espresso' }, recipeId: null, recipe: null, drinkId: 'latte', drink: { id: 'latte', name: 'Latte', hasIngredients: true } }), sources());
    expect(p).toMatchObject({ what: 'cat:milk', item: 'drink:latte', brewerId: 'lm', recipeId: '' });
  });
  it('an archived bean falls back to the newest active bag of the same coffee', () => {
    const p = repeatPlan(log(), sources({ beans: [bean('guji4', '4', '2026-10-15'), bean('guji5', '5', '2026-10-20'), { ...bean('other', null, '2026-10-22'), beanName: 'Sidamo' }] }));
    expect(p.beanId).toBe('guji5');
    expect(p.missing[0]).toMatch(/Guji · Batch 3 is archived.*Batch 5/);
  });
  it('without another bag, the bean is left to pick', () => {
    const p = repeatPlan(log(), sources({ beans: [] }));
    expect(p.beanId).toBe('');
    expect(p.missing[0]).toMatch(/pick a bean/);
  });
  it('skips and names what is archived', () => {
    const p = repeatPlan(log(), sources({ recipes: [{ id: 'house', brewer: { id: 'v60' }, archivedAt: '2026-10-22' } as Recipe], grinders: [], waterProfiles: [] }));
    expect(p).toMatchObject({ recipeId: '', grinderId: '', waterProfileId: null, what: 'method:pour' });
    expect(p.missing.join(' ')).toMatch(/House V60.*C40.*TWW/);
    const noBrewer = repeatPlan(log(), sources({ brewers: [] }));
    expect(noBrewer).toMatchObject({ what: 'none', item: '', brewerId: '', recipeId: '' });
  });
  it('a brew without a recipe repeats without one', () => {
    expect(repeatPlan(log({ brewerId: null, brewer: null, recipeId: null, recipe: null }), sources())).toMatchObject({ what: 'none', missing: [] });
  });
});

describe('quick repeats', () => {
  const brewers = sources().brewers;
  const at = (id: string, over: Partial<BrewLog>) => log({ id, ...over });
  const espresso = { brewerId: 'lm', brewer: { id: 'lm', name: 'Linea', kind: 'espresso' as const } };
  it('one per thing made: a drink, or a plain brew of a method', () => {
    expect(madeKey(log(), brewers)).toBe('plain:pour');
    expect(madeKey(at('x', { ...espresso, drinkId: 'latte' }), brewers)).toBe('drink:latte');
    expect(madeKey(at('x', espresso), brewers)).toBe('plain:espresso');
  });
  it('the newest of each of the last 3, newest first', () => {
    const logs = [at('a', {}), at('b', { ...espresso, drinkId: 'latte' }), at('c', {}), at('d', espresso), at('e', { brewerId: null, brewer: null }), at('f', espresso)];
    expect(recentByMade(logs, brewers).map((l) => l.id)).toEqual(['a', 'b', 'd']);
  });
  it('labels a brew by what it made, its bean and day', () => {
    expect(repeatLabel(log(), new Date('2026-10-23T12:00:00Z'))).toMatchObject({ made: 'V60', bean: 'Guji · Batch 3' });
    expect(repeatLabel(log({ drink: { id: 'latte', name: 'Latte', hasIngredients: true } })).made).toBe('Latte');
  });
});
