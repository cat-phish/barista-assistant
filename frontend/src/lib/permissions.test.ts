import { describe, expect, it } from 'vitest';
import { canModifyBrewLog } from './permissions';

describe('canModifyBrewLog', () => {
  const mine = { brewer: { id: 'me', email: 'me@x' } };
  const theirs = { brewer: { id: 'them', email: 'them@x' } };
  const orphan = { brewer: null };
  it('owners can change any log', () => {
    for (const log of [mine, theirs, orphan]) expect(canModifyBrewLog(log, 'owner', 'me')).toBe(true);
  });
  it('baristas only their own; viewers never', () => {
    expect(canModifyBrewLog(mine, 'barista', 'me')).toBe(true);
    expect(canModifyBrewLog(theirs, 'barista', 'me')).toBe(false);
    expect(canModifyBrewLog(orphan, 'barista', 'me')).toBe(false);
    expect(canModifyBrewLog(mine, 'viewer', 'me')).toBe(false);
    expect(canModifyBrewLog(mine, undefined, 'me')).toBe(false);
  });
});
