// How the public menu shows a bean (docs/api/public-menu.md §7): only the
// details its beans block includes (BEAN_MENU_FIELDS). Unit-tested in
// publicMenu.test.ts.
import type { BeanMenuField, PublicBean } from '../api/types';
import { BEAN_PROCESSES, BLEND_TYPES, DETAILED_ROAST_LEVELS, ROAST_TYPES, formatAltitude } from './beans';
import { ORIGIN_AREAS } from './origins';
import { ROAST_LEVELS } from './scale';

// The builder's checklist, in the order the guest page shows them.
export const BEAN_MENU_FIELDS: Record<BeanMenuField, string> = {
  flavorProfile: 'Flavour notes',
  origin: 'Origin (country and region)',
  producer: 'Producer',
  altitude: 'Altitude',
  process: 'Process',
  roastLevel: 'Roast level',
  roastDate: 'Roast date (how many days ago)',
  decaf: 'Decaf badge',
  blendType: 'Single origin / blend badge',
  roastType: 'Roasted for (filter, espresso) badge',
};

export interface BeanLines {
  badges: string[]; // "Decaf", "Single origin", "Espresso roast"
  origin: string | null; // "Colombia, Huila · Finca El Paraíso · 1,950 m"
  roast: string | null; // "Washed · City+ roast · roasted 5 days ago"
  flavor: string | null;
}

const DAY = 86_400_000;
// "roasted today", "roasted yesterday", "roasted 5 days ago" (calendar days, UTC dates).
export function roastedAgo(roastDate: string, now: Date = new Date()): string {
  const days = Math.max(0, Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.parse(roastDate.slice(0, 10))) / DAY));
  return days === 0 ? 'roasted today' : days === 1 ? 'roasted yesterday' : `roasted ${days} days ago`;
}

export function beanLines(b: PublicBean, fields: readonly BeanMenuField[], now: Date = new Date()): BeanLines {
  const has = (f: BeanMenuField) => fields.includes(f);
  const badges = [
    has('decaf') && b.decaf ? 'Decaf' : null,
    has('blendType') && b.blendType && b.blendType !== 'other' ? BLEND_TYPES[b.blendType].label : null,
    has('roastType') && b.roastType ? `${ROAST_TYPES[b.roastType].label} roast` : null,
  ].filter((x): x is string => !!x);

  const place = has('origin') ? [b.country, b.region].filter(Boolean).join(', ') || (b.originArea ? ORIGIN_AREAS[b.originArea].label : '') : '';
  const origin = [place || null, has('producer') ? b.producer : null, has('altitude') && b.altitudeMasl != null ? formatAltitude(b.altitudeMasl) : null] // guests have no preference: metres
    .filter((x): x is string => !!x)
    .join(' · ');

  const level = has('roastLevel')
    ? b.detailedRoastLevel
      ? `${DETAILED_ROAST_LEVELS[b.detailedRoastLevel].label} roast`
      : b.roastLevel
        ? `${ROAST_LEVELS[b.roastLevel].label} roast`
        : null
    : null;
  const roast = [has('process') && b.process ? BEAN_PROCESSES[b.process].label : null, level, has('roastDate') && b.roastDate ? roastedAgo(b.roastDate, now) : null]
    .filter((x): x is string => !!x)
    .join(' · ');

  return { badges, origin: origin || null, roast: roast || null, flavor: has('flavorProfile') ? (b.flavorProfile ?? null) : null };
}
