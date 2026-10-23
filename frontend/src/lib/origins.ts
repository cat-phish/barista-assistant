import type { OriginArea } from '../api/types';

// docs/schema.md ORIGIN_AREAS, as the coffee trade groups origins.
export const ORIGIN_AREAS: Record<OriginArea, { label: string }> = {
  africa: { label: 'Africa' },
  arabia: { label: 'Arabia' },
  central_america: { label: 'Central America & Mexico' },
  south_america: { label: 'South America' },
  asia: { label: 'Asia' },
  pacific: { label: 'Pacific' },
};

// Coffee-producing countries and their area: suggestions for the free-text
// country field, and the area to fill in when one is picked.
export const COUNTRY_AREAS: Record<string, OriginArea> = {
  Burundi: 'africa',
  Cameroon: 'africa',
  'Congo (DRC)': 'africa',
  Ethiopia: 'africa',
  Kenya: 'africa',
  Malawi: 'africa',
  Rwanda: 'africa',
  Tanzania: 'africa',
  Uganda: 'africa',
  Zambia: 'africa',
  Zimbabwe: 'africa',
  Yemen: 'arabia',
  'Costa Rica': 'central_america',
  Cuba: 'central_america',
  'Dominican Republic': 'central_america',
  'El Salvador': 'central_america',
  Guatemala: 'central_america',
  Haiti: 'central_america',
  Honduras: 'central_america',
  Jamaica: 'central_america',
  Mexico: 'central_america',
  Nicaragua: 'central_america',
  Panama: 'central_america',
  'Puerto Rico': 'central_america',
  Bolivia: 'south_america',
  Brazil: 'south_america',
  Colombia: 'south_america',
  Ecuador: 'south_america',
  Peru: 'south_america',
  Venezuela: 'south_america',
  China: 'asia',
  India: 'asia',
  Indonesia: 'asia',
  Laos: 'asia',
  Myanmar: 'asia',
  Nepal: 'asia',
  Philippines: 'asia',
  Taiwan: 'asia',
  Thailand: 'asia',
  Vietnam: 'asia',
  Australia: 'pacific',
  Hawaii: 'pacific',
  'Papua New Guinea': 'pacific',
  'Timor-Leste': 'pacific',
};

// The area for a known country (case-insensitive), else null.
export function areaForCountry(country: string): OriginArea | null {
  const key = country.trim().toLowerCase();
  const match = Object.keys(COUNTRY_AREAS).find((c) => c.toLowerCase() === key);
  return match ? COUNTRY_AREAS[match] : null;
}
