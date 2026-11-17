import { describe, expect, it } from 'vitest';
import { forWhoText } from './forWho';

const sam = { id: 's', name: 'Sam' };
const ana = { id: 'a', name: 'Ana' };

describe('forWhoText', () => {
  it('is null for a brew that is yours alone', () => {
    expect(forWhoText({ forMe: true, guests: [], unnamedGuests: 0 })).toBeNull();
  });
  it('names who it was for', () => {
    expect(forWhoText({ forMe: true, guests: [sam], unnamedGuests: 0 })).toBe('Me and Sam');
    expect(forWhoText({ forMe: false, guests: [ana, sam], unnamedGuests: 1 })).toBe('Ana, Sam and 1 other guest');
    expect(forWhoText({ forMe: true, guests: [], unnamedGuests: 2 })).toBe('Me and 2 other guests');
    expect(forWhoText({ forMe: false, guests: [], unnamedGuests: 3 })).toBe('3 guests');
    expect(forWhoText({ forMe: false, guests: [sam], unnamedGuests: 0 })).toBe('Sam');
  });
});
