import { describe, expect, it } from 'vitest';
import { reviewChange, reviewRequest, startingBrewers } from './beanReview';

const used = [{ id: 'v60' }, { id: 'chemex' }];

describe('startingBrewers', () => {
  it('ticks every brewer for "all"', () => {
    expect(startingBrewers('all', used)).toEqual(['v60', 'chemex']);
  });
  it('keeps the chosen ones this bean used', () => {
    expect(startingBrewers(['chemex', 'aeropress'], used)).toEqual(['chemex']);
  });
  it('ticks every brewer when none of the choice applies', () => {
    expect(startingBrewers(['aeropress'], used)).toEqual(['v60', 'chemex']);
  });
});

describe('reviewRequest', () => {
  const choice = { used, maxBrews: 10, ratedOnly: true, note: '' };
  it('asks for every brew with all brewers ticked', () => {
    expect(reviewRequest({ ...choice, ticked: ['chemex', 'v60'] })).toEqual({ brewerIds: null, maxBrews: 10, ratedOnly: true });
  });
  it('names the ticked brewers otherwise, and sends a trimmed note', () => {
    expect(reviewRequest({ ...choice, ticked: ['v60'], note: ' With milk ' })).toEqual({ brewerIds: ['v60'], maxBrews: 10, ratedOnly: true, note: 'With milk' });
  });
});

describe('reviewChange', () => {
  it('sends a new or edited review, trimmed', () => {
    expect(reviewChange(' Juicy ', null)).toEqual({ review: 'Juicy' });
    expect(reviewChange('Juicy', 'Thin')).toEqual({ review: 'Juicy' });
  });
  it('sends nothing when unchanged, and null to clear it', () => {
    expect(reviewChange('Juicy', 'Juicy')).toEqual({});
    expect(reviewChange('  ', null)).toEqual({});
    expect(reviewChange('', 'Juicy')).toEqual({ review: null });
  });
});
