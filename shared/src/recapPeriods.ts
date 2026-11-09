// Recap periods (docs/api/recaps.md §11c): weeks starting on the person's chosen
// day, and calendar months, as local dates "YYYY-MM-DD" (inclusive ends).
// No imports: the frontend keeps the same code in lib/recapPeriods.ts, and a
// test there runs both on the same cases.

export const RECAP_KINDS = ["weekly", "monthly"] as const;
export type RecapKind = (typeof RECAP_KINDS)[number];
export interface RecapPeriod {
  start: string;
  end: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const toDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => iso(new Date(toDate(day).getTime() + n * 86_400_000));

// The period a day falls in. weekStartsOn: 0 = Sunday … 6 = Saturday.
export function periodOf(kind: RecapKind, day: string, weekStartsOn: number): RecapPeriod {
  if (kind === "weekly") {
    const back = (toDate(day).getUTCDay() - weekStartsOn + 7) % 7;
    const start = addDays(day, -back);
    return { start, end: addDays(start, 6) };
  }
  const d = toDate(day);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: `${day.slice(0, 7)}-01`, end: iso(last) };
}
export const previousPeriod = (kind: RecapKind, p: RecapPeriod, weekStartsOn: number): RecapPeriod => periodOf(kind, addDays(p.start, -1), weekStartsOn);
export const nextPeriod = (kind: RecapKind, p: RecapPeriod, weekStartsOn: number): RecapPeriod => periodOf(kind, addDays(p.end, 1), weekStartsOn);
// The last whole period before today's.
export const justEnded = (kind: RecapKind, today: string, weekStartsOn: number): RecapPeriod => previousPeriod(kind, periodOf(kind, today, weekStartsOn), weekStartsOn);
// Whole days from a period's end to a day (1 = the day after it ended).
export const daysAfter = (p: RecapPeriod, day: string): number => Math.round((toDate(day).getTime() - toDate(p.end).getTime()) / 86_400_000);

// "3–9 Nov", "29 Oct – 4 Nov", "28 Dec 2026 – 3 Jan 2027"; "November 2026".
export function periodLabel(kind: RecapKind, p: RecapPeriod): string {
  const [sy, sm, sd] = p.start.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = p.end.split("-").map(Number) as [number, number, number];
  if (kind === "monthly") return `${MONTH_NAMES[sm - 1]} ${sy}`;
  if (sy !== ey) return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`;
  if (sm !== em) return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`;
  return `${sd}–${ed} ${MONTHS[em - 1]}`;
}
