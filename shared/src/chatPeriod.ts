// A live Period attachment in chat (docs/api/chat.md §12, "Periods"): the
// picker's Brews filters saved as one item, run again for every reply.
// Rolling ranges count back from the reply's day; a calendar week or month
// and custom dates are fixed when attached. Local dates "YYYY-MM-DD".
// No imports: the frontend keeps the same code in lib/chatPeriod.ts, and a
// test there runs both on the same cases.

export const CHAT_PERIOD_RANGES = ["7d", "30d", "90d", "1y", "all", "week", "month", "custom"] as const;
export type ChatPeriodRange = (typeof CHAT_PERIOD_RANGES)[number];
export const ROLLING_DAYS = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 } as const;
export type RollingRange = keyof typeof ROLLING_DAYS;
export const isRolling = (r: ChatPeriodRange): r is RollingRange => r in ROLLING_DAYS;
// Has its own dates: from and to both set; the others have neither.
export const isFixed = (r: ChatPeriodRange): boolean => r === "week" || r === "month" || r === "custom";

export interface ChatPeriodSpec {
  range: ChatPeriodRange;
  from: string | null;
  to: string | null;
  beanId: string | null;
  recipeId: string | null;
  brewerId: string | null;
  mine: boolean;
}

// How many brews a Period sends in detail (the rest are counted): the
// workspace's chatPeriodMaxBrews, or a person's own lower one.
export const CHAT_PERIOD_BREWS_MIN = 10;
export const CHAT_PERIOD_BREWS_MAX = 300;
export const CHAT_PERIOD_BREWS_DEFAULT = 60;

export interface DayRange {
  start: string | null; // null: from the first brew (all time)
  end: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const toDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const plusDays = (day: string, n: number): string => iso(new Date(toDate(day).getTime() + n * 86_400_000));
const daysIn = (start: string, end: string): number => Math.round((toDate(end).getTime() - toDate(start).getTime()) / 86_400_000) + 1;
const monthOf = (day: string): { start: string; end: string } => {
  const d = toDate(day);
  return { start: `${day.slice(0, 7)}-01`, end: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) };
};
const weekOf = (day: string, weekStartsOn: number): { start: string; end: string } => {
  const start = plusDays(day, -((toDate(day).getUTCDay() - weekStartsOn + 7) % 7));
  return { start, end: plusDays(start, 6) };
};

// The picker's calendar choices, fixed to their dates on the day attached.
export type CalendarChoice = "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth";
export function calendarDates(choice: CalendarChoice, today: string, weekStartsOn: number): { range: "week" | "month"; from: string; to: string } {
  if (choice === "thisWeek" || choice === "lastWeek") {
    const w = weekOf(choice === "thisWeek" ? today : plusDays(weekOf(today, weekStartsOn).start, -1), weekStartsOn);
    return { range: "week", from: w.start, to: w.end };
  }
  const m = monthOf(choice === "thisMonth" ? today : plusDays(`${today.slice(0, 7)}-01`, -1));
  return { range: "month", from: m.start, to: m.end };
}

// The days a Period covers on `today`, and the ones before it under the same
// filters: the calendar week or month before, else as many days before;
// none for all time.
export function resolveChatPeriod(spec: Pick<ChatPeriodSpec, "range" | "from" | "to">, today: string): { period: DayRange; previous: { start: string; end: string } | null } {
  if (spec.range === "all") return { period: { start: null, end: today }, previous: null };
  if (isRolling(spec.range)) {
    const n = ROLLING_DAYS[spec.range];
    const start = plusDays(today, -(n - 1));
    return { period: { start, end: today }, previous: { start: plusDays(start, -n), end: plusDays(start, -1) } };
  }
  const start = spec.from ?? today;
  const end = spec.to ?? today;
  if (spec.range === "month") return { period: { start, end }, previous: monthOf(plusDays(start, -1)) };
  const n = daysIn(start, end);
  return { period: { start, end }, previous: { start: plusDays(start, -n), end: plusDays(start, -1) } };
}

const ROLLING_NAMES: Record<RollingRange, string> = { "7d": "last 7 days", "30d": "last 30 days", "90d": "last 90 days", "1y": "last year" };
// "3–9 Nov", "29 Oct – 4 Nov", "28 Dec 2026 – 3 Jan 2027".
function datesLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = end.split("-").map(Number) as [number, number, number];
  if (start === end) return `${sd} ${MONTHS[sm - 1]} ${sy}`;
  if (sy !== ey) return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`;
  if (sm !== em) return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`;
  return `${sd}–${ed} ${MONTHS[em - 1]}`;
}
// The days in words: "last 30 days", "all time", "November 2026", "3–9 Nov".
export function periodDaysLabel(spec: Pick<ChatPeriodSpec, "range" | "from" | "to">): string {
  if (spec.range === "all") return "all time";
  if (isRolling(spec.range)) return ROLLING_NAMES[spec.range];
  const from = spec.from ?? "";
  const to = spec.to ?? "";
  if (spec.range === "month" && from.slice(0, 7) === to.slice(0, 7)) return `${MONTH_NAMES[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  return datesLabel(from, to);
}
// The filters in words, after the days: "Guji · V60 · Only mine".
export function periodFiltersLabel(spec: Pick<ChatPeriodSpec, "mine">, names: { bean?: string | null; recipe?: string | null; brewer?: string | null }): string {
  return [names.bean, names.recipe, names.brewer, spec.mine ? "Only mine" : null].filter((s): s is string => !!s).join(" · ");
}
// The chip: "Brews, last 30 days · Guji · Only mine".
export function periodLabel(spec: ChatPeriodSpec, names: { bean?: string | null; recipe?: string | null; brewer?: string | null }): string {
  const filters = periodFiltersLabel(spec, names);
  return `Brews, ${periodDaysLabel(spec)}${filters ? ` · ${filters}` : ""}`;
}
