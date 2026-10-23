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
    expect(usageWarnings('tool', { brewLogCount: 3 })).toEqual(['3 brews will no longer list this tool.']);
  });
});
