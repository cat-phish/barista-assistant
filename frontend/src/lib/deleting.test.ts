import { describe, expect, it } from 'vitest';
import { usageWarnings } from './deleting';

describe('usageWarnings', () => {
  it('says what a brewer takes with it, leaving zero counts out', () => {
    expect(usageWarnings('brewer', { recipeCount: 2, brewLogCount: 1, menuItemCount: 0 })).toEqual([
      'Its 2 recipes will be deleted too.',
      '1 brew will lose their brewer and recipe. Everything else in them stays.',
    ]);
  });

  it('is empty when nothing uses it', () => {
    expect(usageWarnings('grinder', { brewLogCount: 0, recipeCount: 0 })).toEqual([]);
    expect(usageWarnings('water', {})).toEqual([]);
  });

  it('words each kind', () => {
    expect(usageWarnings('ingredient', { drinkCount: 1 })).toEqual(['It will be removed from 1 drink.']);
    expect(usageWarnings('drink', { variantCount: 2 })).toEqual(['Its 2 variants are kept and move up a level.']);
    expect(usageWarnings('tool', { brewLogCount: 3 })).toEqual(['3 brews will no longer list this prep item.']);
    expect(usageWarnings('process', { beanCount: 2 })).toEqual(['2 beans will lose their process.']);
    expect(usageWarnings('style', { recipeCount: 1 })).toEqual(['1 recipe will lose their style.']);
    expect(usageWarnings('roaster', { roastCount: 0 })).toEqual([]);
    expect(usageWarnings('green', { roastCount: 2 })).toEqual(['2 roasts will no longer say which green coffee they were. Their beans stay.']);
    expect(usageWarnings('method', { brewerCount: 2 })).toEqual(["2 brewers will move to the built-in method it works like. Their recipes and brews don't change."]);
  });
});
