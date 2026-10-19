// Effective roast age (docs/api_spec.md §4): days since roasting minus days
// spent frozen, so the age pauses while frozen and resumes after thawing.
// Dates are calendar dates (YYYY-MM-DD). Twin copy in
// worker/src/roastAge.ts; keep both in sync (both have tests).

export interface FreezePeriodLike {
  frozenOn: string;
  thawedOn: string | null; // null = still frozen
}

export interface RoastAge {
  ageDays: number; // effective age, frozen time excluded
  daysFrozen: number; // frozen days between roasting and `onDate`
}

function dayNumber(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

export function effectiveRoastAge(roastDate: string, periods: readonly FreezePeriodLike[], onDate: string): RoastAge {
  const roast = dayNumber(roastDate);
  const at = dayNumber(onDate);
  let daysFrozen = 0;
  for (const p of periods) {
    // Only the part of each period between roasting and `onDate` counts.
    const start = Math.max(dayNumber(p.frozenOn), roast);
    const end = Math.min(p.thawedOn ? dayNumber(p.thawedOn) : at, at);
    if (end > start) daysFrozen += end - start;
  }
  return { ageDays: at - roast - daysFrozen, daysFrozen };
}
