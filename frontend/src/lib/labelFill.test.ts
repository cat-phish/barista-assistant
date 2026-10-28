import { describe, expect, it } from 'vitest';
import type { BeanProcess, LabelFields } from '../api/types';
import { labelFill, type LabelForm } from './labelFill';

const NONE: LabelFields = {
  roasterName: null,
  beanName: null,
  processName: null,
  processText: null,
  country: null,
  region: null,
  producer: null,
  altitudeMasl: null,
  flavorProfile: null,
  roastDate: null,
  detailedRoastLevel: null,
  roastLevel: null,
  roastType: null,
  blendType: null,
  decaf: null,
  bagWeightGrams: null,
  batchNumber: null,
  website: null,
};
const EMPTY: LabelForm = {
  roasterName: '',
  beanName: '',
  process: '',
  country: '',
  region: '',
  producer: '',
  altitude: '',
  flavorProfile: '',
  roastDate: '',
  roastLevel: '',
  roastType: '',
  blendType: '',
  decaf: false,
  bagWeight: '',
  batchNumber: '',
  website: '',
  notes: '',
};
const processes: BeanProcess[] = [
  { id: 'p-washed', name: 'Washed', position: 1, hidden: false, builtin: 'washed' },
  { id: 'p-natural', name: 'Natural', position: 2, hidden: false, builtin: 'natural' },
  { id: 'p-honey', name: 'Honey', position: 3, hidden: true, builtin: 'honey' },
];
const options = { processes, altitudeUnit: 'm' as const, roastScale: 'names' as const };

describe('labelFill', () => {
  it('fills empty fields, in the form’s terms', () => {
    const { fills, suggestions } = labelFill(
      {
        ...NONE,
        roasterName: 'Onyx',
        beanName: 'Geometry',
        processName: 'Washed',
        country: 'Ethiopia',
        altitudeMasl: 2000,
        detailedRoastLevel: 'city',
        roastType: 'filter',
        decaf: true,
        bagWeightGrams: 340,
        website: 'https://onyxcoffeelab.com/',
      },
      EMPTY,
      options,
    );
    expect(fills).toEqual({
      roasterName: 'Onyx',
      beanName: 'Geometry',
      process: 'p-washed',
      country: 'Ethiopia',
      altitude: '2000',
      roastLevel: 'city',
      roastType: 'filter',
      decaf: true,
      bagWeight: '340',
      website: 'https://onyxcoffeelab.com/',
    });
    expect(suggestions).toEqual({});
  });

  it('suggests where the form already says something else, and skips what matches', () => {
    const form = { ...EMPTY, roasterName: 'onyx ', beanName: 'Geo', process: 'p-natural', altitude: '6000', website: 'https://onyxcoffeelab.com' };
    const { fills, suggestions } = labelFill(
      { ...NONE, roasterName: 'Onyx', beanName: 'Geometry', processName: 'Washed', altitudeMasl: 2000, website: 'https://onyxcoffeelab.com/' },
      form,
      { ...options, altitudeUnit: 'ft' },
    );
    expect(fills).toEqual({});
    expect(suggestions).toEqual({
      beanName: { value: 'Geometry', text: 'Geometry' },
      process: { value: 'p-washed', text: 'Washed' },
      altitude: { value: '6562', text: '6562 ft' },
    });
  });

  it('puts a process that isn’t in the list in the notes', () => {
    const odd = { ...NONE, processText: 'Anaerobic natural' };
    expect(labelFill(odd, EMPTY, options).fills.notes).toBe('Process: Anaerobic natural');
    expect(labelFill(odd, { ...EMPTY, notes: 'Lovely.' }, options).suggestions.notes).toEqual({
      value: 'Lovely.\nProcess: Anaerobic natural',
      text: 'Process: Anaerobic natural',
    });
    // Already noted; a hidden process counts as not in the list.
    expect(labelFill(odd, { ...EMPTY, notes: 'process: anaerobic natural' }, options)).toEqual({ fills: {}, suggestions: {} });
    expect(labelFill({ ...NONE, processName: 'Honey' }, EMPTY, options).fills).toEqual({ notes: 'Process: Honey' });
  });

  it('follows the workspace’s roast scale', () => {
    const named = { ...NONE, detailedRoastLevel: 'full_city' as const };
    const levelOnly = { ...NONE, roastLevel: 'light' as const };
    const levels = { ...options, roastScale: 'levels' as const };
    expect(labelFill(named, EMPTY, levels).fills.roastLevel).toBe('medium');
    expect(labelFill(levelOnly, EMPTY, levels).fills.roastLevel).toBe('light');
    // Roast names: a bare level can't be picked.
    expect(labelFill(levelOnly, EMPTY, options).fills).toEqual({});
    expect(labelFill(named, { ...EMPTY, roastLevel: 'city' }, options).suggestions.roastLevel).toEqual({ value: 'full_city', text: 'Full City' });
  });
});
