import { describe, expect, it } from 'vitest';
import { undoChanges } from './undoFill';

describe('undoChanges', () => {
  const before = { country: '', region: 'Guji', varieties: [] as string[], suggestions: {} };
  const after = { country: 'Ethiopia', region: 'Guji', varieties: ['74110'], suggestions: { region: { value: 'Yirgacheffe' } } };

  it('puts back what the fill changed', () => {
    expect(undoChanges(before, after, after)).toEqual({ country: '', varieties: [], suggestions: {} });
  });

  it("keeps a field that's been edited since", () => {
    expect(undoChanges(before, after, { ...after, country: 'Kenya' })).toEqual({ varieties: [], suggestions: {} });
  });

  it("leaves fields the fill didn't change", () => {
    expect(undoChanges(before, after, { ...after, region: 'Sidama' })).not.toHaveProperty('region');
  });
});
