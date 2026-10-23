import { describe, expect, it } from 'vitest';
import { areaForCountry } from './origins';

describe('areaForCountry', () => {
  it('finds a known country, ignoring case and spaces', () => {
    expect(areaForCountry('Kenya')).toBe('africa');
    expect(areaForCountry('  papua new guinea ')).toBe('pacific');
  });

  it('returns null for an unknown or partial name', () => {
    expect(areaForCountry('Atlantis')).toBeNull();
    expect(areaForCountry('Ethiopia, Colombia')).toBeNull();
    expect(areaForCountry('')).toBeNull();
  });
});
