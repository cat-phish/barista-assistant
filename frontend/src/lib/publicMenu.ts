// How the public menu shows a bean (docs/api/public-menu.md §7): only the
// details its beans block includes (BEAN_MENU_FIELDS). Unit-tested in
// publicMenu.test.ts.
import type { BeanMenuField, PublicBean } from '../api/types';
import { BLEND_TYPES, DETAILED_ROAST_LEVELS, ROAST_TYPES, formatAltitude, speciesLabel } from './beans';
import { ORIGIN_AREAS } from './origins';
import { effectiveRoastAge, type FreezePeriodLike } from './roastAge';
import { ROAST_LEVELS } from './scale';

// The builder's checklist, in the order the guest page shows them.
export const BEAN_MENU_FIELDS: Record<BeanMenuField, string> = {
  flavorProfile: 'Flavour notes',
  origin: 'Origin (country and region)',
  producer: 'Producer',
  altitude: 'Altitude',
  variety: 'Variety and species',
  process: 'Process',
  roastLevel: 'Roast level',
  roastDate: 'Days off roast',
  decaf: 'Decaf badge',
  blendType: 'Single origin / blend badge',
  roastType: 'Roasted for (filter, espresso) badge',
};

export interface BeanLines {
  badges: string[]; // "Decaf", "Single origin", "Espresso roast"
  origin: string | null; // "Colombia, Huila · Finca El Paraíso · 1,950 m · Pink Bourbon"
  roast: string | null; // "Washed · City+ roast · roasted 5 days ago"
  flavor: string | null;
  batch: string | null; // "Batch 3": the same coffee listed more than once
}

// "0 days off roast", "1 day off roast", "12 days off roast": calendar days,
// counted afresh each day, not counting days spent frozen (docs/api/beans.md §4).
export function daysOffRoast(roastDate: string, freezes: readonly FreezePeriodLike[] = [], now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const days = Math.max(0, effectiveRoastAge(roastDate, freezes, today).ageDays);
  return `${days} ${days === 1 ? 'day' : 'days'} off roast`;
}

export function beanLines(b: PublicBean, fields: readonly BeanMenuField[], now: Date = new Date()): BeanLines {
  // A detail that tells the same coffee apart shows even if the block hides it.
  const has = (f: BeanMenuField) => fields.includes(f) || !!b.differs?.includes(f);
  const badges = [
    has('decaf') && b.decaf ? 'Decaf' : null,
    has('blendType') && b.blendType && b.blendType !== 'other' ? BLEND_TYPES[b.blendType].label : null,
    has('roastType') && b.roastType ? `${ROAST_TYPES[b.roastType].label} roast` : null,
    // Arabica is what guests expect: only worth a badge when it's something else.
    has('variety') && b.species?.some((s) => s !== 'arabica') ? speciesLabel(b.species) : null,
  ].filter((x): x is string => !!x);

  const place = has('origin') ? [b.country, b.region].filter(Boolean).join(', ') || (b.originArea ? ORIGIN_AREAS[b.originArea].label : '') : '';
  const origin = [place || null, has('producer') ? b.producer : null, has('altitude') && b.altitudeMasl != null ? formatAltitude(b.altitudeMasl) : null, has('variety') ? (b.varieties?.join(', ') ?? null) : null] // guests have no preference: metres
    .filter((x): x is string => !!x)
    .join(' · ');

  const level = has('roastLevel')
    ? b.detailedRoastLevel
      ? `${DETAILED_ROAST_LEVELS[b.detailedRoastLevel].label} roast`
      : b.roastLevel
        ? `${ROAST_LEVELS[b.roastLevel].label} roast`
        : null
    : null;
  const roast = [has('process') && b.process ? b.process : null, level, has('roastDate') && b.roastDate ? daysOffRoast(b.roastDate, b.freezes, now) : null]
    .filter((x): x is string => !!x)
    .join(' · ');

  return {
    badges,
    origin: origin || null,
    roast: roast || null,
    flavor: has('flavorProfile') ? (b.flavorProfile ?? null) : null,
    batch: b.differs?.includes('batchNumber') && b.batchNumber ? `Batch ${b.batchNumber}` : null,
  };
}
