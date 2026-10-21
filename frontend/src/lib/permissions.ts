import type { BrewLog, Role } from '../api/types';

// Mirrors the API (docs/api/brew-logs.md §6): owners can change any brew log;
// baristas only their own; logs of deleted accounts only owners.
export function canModifyBrewLog(log: Pick<BrewLog, 'brewedBy'>, role: Role | undefined, myUserId: string | undefined): boolean {
  if (role === 'owner') return true;
  return role === 'barista' && !!myUserId && log.brewedBy?.id === myUserId;
}
