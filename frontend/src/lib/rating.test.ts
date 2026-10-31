import { describe, expect, it } from 'vitest';
import { brewAverageText, ratingLabel, starFills, starValues } from './rating';

describe('starFills', () => {
  it('fills whole stars, then a half for a .5', () => {
    expect(starFills(3.5)).toEqual(['full', 'full', 'full', 'half', 'empty']);
    expect(starFills(0.5)).toEqual(['half', 'empty', 'empty', 'empty', 'empty']);
    expect(starFills(5)).toEqual(['full', 'full', 'full', 'full', 'full']);
    expect(starFills(2)).toEqual(['full', 'full', 'empty', 'empty', 'empty']);
  });
});

describe('starValues', () => {
  it('offers the half below each star only in half steps', () => {
    expect(starValues(1, 'half')).toEqual([0.5, 1]);
    expect(starValues(4, 'half')).toEqual([3.5, 4]);
    expect(starValues(4, 'whole')).toEqual([4]);
  });
});

describe('ratingLabel', () => {
  it('names whole stars and numbers the halves', () => {
    expect(ratingLabel(4)).toBe('4 – Good');
    expect(ratingLabel(1)).toBe('1 – Bad');
    expect(ratingLabel(3.5)).toBe('3.5');
  });
});

describe('brewAverageText', () => {
  it('rounds to one decimal and says how many were rated', () => {
    expect(brewAverageText({ averageRating: 3.83, ratedCount: 12 })).toBe('Brews average 3.8 from 12 rated');
  });
  it('says nothing with nothing rated, or no summary yet', () => {
    expect(brewAverageText({ averageRating: null, ratedCount: 0 })).toBeNull();
    expect(brewAverageText(null)).toBeNull();
  });
});
