import { describe, expect, it } from 'vitest';
import type { BeanMenuField, PublicBean } from '../api/types';
import { BEAN_MENU_FIELDS, beanLines, roastedAgo } from './publicMenu';

const all = Object.keys(BEAN_MENU_FIELDS) as BeanMenuField[];
const now = new Date(2026, 9, 22); // Oct 22, local
const bean: PublicBean = {
  id: 'b', roasterName: 'Onyx', beanName: 'Southern Weather', process: 'Washed', roastDate: '2026-10-17T00:00:00.000Z',
  roastLevel: 'medium', detailedRoastLevel: 'city_plus', roastType: 'espresso', blendType: 'single_origin', decaf: true,
  flavorProfile: 'Milk chocolate, plum', originArea: 'south_america', country: 'Colombia', region: 'Huila', altitudeMasl: 1950, producer: 'Finca El Paraíso',
  varieties: ['Pink Bourbon'], species: ['arabica'],
};

describe('beanLines', () => {
  it('shows every chosen detail', () => {
    expect(beanLines(bean, all, now)).toEqual({
      badges: ['Decaf', 'Single origin', 'Espresso roast'],
      origin: 'Colombia, Huila · Finca El Paraíso · 1,950 m · Pink Bourbon',
      roast: 'Washed · City+ roast · roasted 5 days ago',
      flavor: 'Milk chocolate, plum',
    });
  });

  it('leaves out what is not chosen or not recorded', () => {
    expect(beanLines(bean, ['origin', 'roastLevel'], now)).toEqual({ badges: [], origin: 'Colombia, Huila', roast: 'City+ roast', flavor: null });
    expect(beanLines({ id: 'b', roasterName: 'R', beanName: 'B' }, all, now)).toEqual({ badges: [], origin: null, roast: null, flavor: null });
  });

  it('falls back to the growing area and the 5-step roast level', () => {
    const plain = { ...bean, country: null, region: null, detailedRoastLevel: null };
    expect(beanLines(plain, ['origin', 'roastLevel'], now)).toMatchObject({ origin: 'South America', roast: 'Medium roast' });
  });
});

describe('beanLines: species', () => {
  it('badges a species only when it is not arabica alone', () => {
    const blend = { ...bean, species: ['arabica', 'robusta'] as PublicBean['species'] };
    expect(beanLines(blend, ['variety'], now)).toMatchObject({ badges: ['Arabica & Robusta'], origin: 'Pink Bourbon' });
    expect(beanLines(bean, ['variety'], now).badges).toEqual([]);
  });
});

describe('roastedAgo', () => {
  it('counts calendar days', () => {
    expect(roastedAgo('2026-10-22T00:00:00.000Z', now)).toBe('roasted today');
    expect(roastedAgo('2026-10-21T00:00:00.000Z', now)).toBe('roasted yesterday');
    expect(roastedAgo('2026-10-12', now)).toBe('roasted 10 days ago');
  });
});
