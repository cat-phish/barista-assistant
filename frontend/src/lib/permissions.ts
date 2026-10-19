import type { BrewLog, Role } from '../api/types';

// Mirrors the API (docs/api_spec.md §6): owners can change any brew log;
// baristas only their own; logs of deleted accounts only owners.
export function canModifyBrewLog(log: Pick<BrewLog, 'brewer'>, role: Role | undefined, myUserId: string | undefined): boolean {
  if (role === 'owner') return true;
  return role === 'barista' && !!myUserId && log.brewer?.id === myUserId;
}
