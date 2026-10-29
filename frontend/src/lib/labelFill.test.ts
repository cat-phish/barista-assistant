import { describe, expect, it } from 'vitest';
import type { BeanProcess, LabelFields } from '../api/types';
import { canLookUp, labelFill, labelImages, lookUpFields, pageLabel, type LabelForm } from './labelFill';

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

describe('labelImages', () => {
  it('sends the photos taken for the read first, then the bean’s, up to 8', () => {
    expect(labelImages(['x'], ['a', 'b'])).toEqual({ images: ['x', 'a', 'b'], left: 0 });
    expect(labelImages(['x', 'y', 'z'], ['a', 'b', 'c', 'd', 'e', 'f'])).toEqual({ images: ['x', 'y', 'z', 'a', 'b', 'c', 'd', 'e'], left: 1 });
  });
});

describe('labelFill with what the web found', () => {
  const page = 'https://onyxcoffeelab.com/products/geometry';
  it('only ever suggests, with the page, never where the form or the label already says it', () => {
    const { fills, suggestions } = labelFill(
      { ...NONE, roasterName: 'Onyx', beanName: 'Geometry' },
      { ...EMPTY, region: 'Guji' },
      options,
      {
        producer: { value: 'Many farms', url: page },
        region: { value: 'guji', url: page }, // what the form says
        beanName: { value: 'Geometry', url: page }, // what the label filled
        altitudeMasl: { value: 2100, url: page },
        processName: { value: 'Washed', url: page },
      },
    );
    expect(fills).toEqual({ roasterName: 'Onyx', beanName: 'Geometry' });
    expect(suggestions).toEqual({
      producer: { value: 'Many farms', text: 'Many farms', source: page },
      altitude: { value: '2100', text: '2100 m', source: page },
      process: { value: 'p-washed', text: 'Washed', source: page },
    });
  });

  it('leaves the label’s own suggestion in place', () => {
    const { suggestions } = labelFill({ ...NONE, beanName: 'Geometry' }, { ...EMPTY, beanName: 'Geo' }, options, {
      beanName: { value: 'Geometry Blend', url: page },
    });
    expect(suggestions).toEqual({ beanName: { value: 'Geometry', text: 'Geometry' } });
  });
});

describe('pageLabel', () => {
  it('shows the host without www. and the path', () => {
    expect(pageLabel('https://www.onyxcoffeelab.com/products/geometry/')).toBe('onyxcoffeelab.com/products/geometry');
    expect(pageLabel('https://onyxcoffeelab.com/')).toBe('onyxcoffeelab.com');
    expect(pageLabel('https://example.com/caf%C3%A9')).toBe('example.com/café');
  });
});

describe('lookUpFields', () => {
  it("keeps what's known, never one bag's details, and the form's website when there's none", () => {
    const fields = { ...NONE, roasterName: 'Onyx', beanName: ' ', altitudeMasl: 2000, roastDate: '2026-10-01', batchNumber: 'B1' };
    expect(lookUpFields(fields, ' onyxcoffeelab.com ')).toEqual({ roasterName: 'Onyx', altitudeMasl: 2000, website: 'onyxcoffeelab.com' });
    expect(lookUpFields({ ...fields, website: 'https://onyx.com' }, 'other.com').website).toBe('https://onyx.com');
    expect(canLookUp(lookUpFields(fields))).toBe(true);
    expect(canLookUp(lookUpFields({ country: 'Ethiopia' }))).toBe(false);
  });
});
