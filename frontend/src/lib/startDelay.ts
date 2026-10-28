import type { MethodKind, UserPreferences } from '../api/types';

// Per-method start delays (docs/api/auth.md §1); a method without one has
// none, and a brew without a type uses Other.
export function startDelayFor(preferences: Pick<UserPreferences, 'startDelays'>, kind: MethodKind | null): 0 | 3 | 5 {
  return preferences.startDelays?.[kind ?? 'other'] ?? 0;
}
