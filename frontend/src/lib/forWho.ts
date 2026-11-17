// Who a brew was for, as one line (docs/api/brew-logs.md §6, "Who it's for"):
// "Me, Sam and 2 other guests". Null for a brew that's yours alone.
// Unit-tested in forWho.test.ts.
import type { BrewLog } from '../api/types';

export function forWhoText(log: Pick<BrewLog, 'forMe' | 'guests' | 'unnamedGuests'>): string | null {
  if (log.forMe && log.guests.length === 0 && log.unnamedGuests === 0) return null;
  const named = log.guests.length > 0 || log.forMe;
  const others = log.unnamedGuests === 0 ? [] : [`${log.unnamedGuests} ${named ? 'other ' : ''}${log.unnamedGuests === 1 ? 'guest' : 'guests'}`];
  const parts = [...(log.forMe ? ['Me'] : []), ...log.guests.map((g) => g.name), ...others];
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
