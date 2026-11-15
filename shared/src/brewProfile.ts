// A barista's brew profile (docs/api/llm-contract.md §9, "Brew profile";
// docs/backlog.md item 19): running figures worked out from all of their
// rated brews, so the AI gets them in a few lines instead of working them
// out from the handful of brews it's sent. Pure, so Insights can share the
// same numbers later. Worked out when a job runs; nothing is stored.

// Only coffee ratings count (rating, not drinkRating).
export interface ProfileBrew {
  timestamp: string; // ISO; brews come newest first
  rating: number;
  methodKind: string | null; // the brewer's kind (filter, espresso, …)
  brewerId: string | null;
  recipeId: string | null;
  roastLevel: string | null; // the bean's
  sameCoffee: boolean; // the bean (any bag of it) the job is about
  roastAgeDays: number | null; // effective, on the brew's day
  tdsPercent: number | null;
  extractionYieldPercent: number | null;
  tempC: number | null;
  doseGrams: number;
  timeSec: number | null;
  routeLabel: string | null; // the suggested route it was brewed from
}

// What the job is about: the figures narrow to it.
export interface ProfileFocus {
  methodKind: string | null;
  brewerId: string | null;
  brewer: string | null;
  recipeId: string | null;
  recipe: string | null;
  roastLevel: string | null; // null when unknown or hidden from the AI
}

export interface RatingBucket {
  at: number; // °C, or the first day of a roast-age week
  brews: number;
  rating: number; // mean, 0.1
}
export interface TimeBucket {
  doseGrams: number;
  brews: number;
  medianSec: number;
}
export interface BrewProfile {
  brews: number; // rated brews it's worked out from
  rating: number; // their mean
  best: { methodKind: string; brews: number; tdsPercent: [number, number] | null; extractionYieldPercent: [number, number] | null } | null;
  temp: { brewer: string; roastLevel: string | null; byTempC: RatingBucket[] } | null;
  time: { recipe: string; byDose: TimeBucket[] } | null;
  roastAge: { byWeek: RatingBucket[] } | null;
  routes: { brews: number; rating: number; otherRating: number | null; recent: Array<{ label: string; rating: number }> } | null;
}

export const PROFILE_MAX_BREWS = 500; // the most recent, so a long history stays cheap
export const BEST_RATING = 4.5; // as the ownPattern finding (@barista/shared/research)
const MIN_BREWS = 4; // a figure resting on fewer isn't shown
const RECENT_ROUTES = 5;

const round = (n: number, step: number): number => Math.round(n / step) * step;
const tenth = (n: number): number => Math.round(n * 10) / 10;
const mean = (xs: readonly number[]): number => tenth(xs.reduce((a, b) => a + b, 0) / xs.length);
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}
// The range most of them fall in: all of a few, the middle 80% of many.
function spread(xs: readonly number[]): [number, number] | null {
  if (xs.length < 3) return null;
  const s = [...xs].sort((a, b) => a - b);
  const cut = s.length >= 8 ? Math.floor(s.length * 0.1) : 0;
  return [s[cut]!, s[s.length - 1 - cut]!];
}
function buckets(brews: readonly ProfileBrew[], at: (b: ProfileBrew) => number | null): RatingBucket[] {
  const by = new Map<number, number[]>();
  for (const b of brews) {
    const k = at(b);
    if (k !== null) by.set(k, [...(by.get(k) ?? []), b.rating]);
  }
  return [...by].sort(([a], [b]) => a - b).map(([k, rs]) => ({ at: k, brews: rs.length, rating: mean(rs) }));
}
// Worth sending: enough brews, spread over at least two buckets.
const telling = (bs: readonly RatingBucket[]): boolean => bs.length >= 2 && bs.reduce((n, b) => n + b.brews, 0) >= MIN_BREWS;

export function buildBrewProfile(brews: readonly ProfileBrew[], focus: ProfileFocus): BrewProfile | null {
  if (brews.length < MIN_BREWS) return null;

  const kindBest = brews.filter((b) => b.rating >= BEST_RATING && b.methodKind !== null && b.methodKind === focus.methodKind);
  const tds = spread(kindBest.flatMap((b) => (b.tdsPercent === null ? [] : [b.tdsPercent])));
  const ey = spread(kindBest.flatMap((b) => (b.extractionYieldPercent === null ? [] : [b.extractionYieldPercent])));
  const best = focus.methodKind && (tds || ey) ? { methodKind: focus.methodKind, brews: kindBest.length, tdsPercent: tds, extractionYieldPercent: ey } : null;

  // Rating by temperature on this brewer, for this roast level when that alone tells enough.
  let temp: BrewProfile["temp"] = null;
  if (focus.brewerId && focus.brewer) {
    const onBrewer = brews.filter((b) => b.brewerId === focus.brewerId);
    const byTemp = (bs: ProfileBrew[]) => buckets(bs, (b) => (b.tempC === null ? null : round(b.tempC, 1)));
    const level = focus.roastLevel ? byTemp(onBrewer.filter((b) => b.roastLevel === focus.roastLevel)) : [];
    const any = byTemp(onBrewer);
    if (telling(level)) temp = { brewer: focus.brewer, roastLevel: focus.roastLevel, byTempC: level };
    else if (telling(any)) temp = { brewer: focus.brewer, roastLevel: null, byTempC: any };
  }

  let time: BrewProfile["time"] = null;
  if (focus.recipeId && focus.recipe) {
    const timed = brews.filter((b) => b.recipeId === focus.recipeId && b.timeSec !== null);
    if (timed.length >= MIN_BREWS) {
      const by = new Map<number, number[]>();
      for (const b of timed) by.set(round(b.doseGrams, 1), [...(by.get(round(b.doseGrams, 1)) ?? []), b.timeSec!]);
      const byDose = [...by].sort(([a], [b]) => a - b).map(([doseGrams, ts]) => ({ doseGrams, brews: ts.length, medianSec: median(ts) }));
      time = { recipe: focus.recipe, byDose };
    }
  }

  const byWeek = buckets(
    brews.filter((b) => b.sameCoffee),
    (b) => (b.roastAgeDays === null ? null : Math.floor(b.roastAgeDays / 7) * 7),
  );
  const roastAge = telling(byWeek) ? { byWeek } : null;

  // How brews from earlier suggested routes went, next to the others since the first one.
  let routes: BrewProfile["routes"] = null;
  const routed = brews.filter((b) => b.routeLabel !== null);
  if (routed.length > 0) {
    const first = routed[routed.length - 1]!.timestamp;
    const others = brews.filter((b) => b.routeLabel === null && b.timestamp >= first);
    routes = {
      brews: routed.length,
      rating: mean(routed.map((b) => b.rating)),
      otherRating: others.length ? mean(others.map((b) => b.rating)) : null,
      recent: routed.slice(0, RECENT_ROUTES).map((b) => ({ label: b.routeLabel!, rating: b.rating })),
    };
  }

  return { brews: brews.length, rating: mean(brews.map((b) => b.rating)), best, temp, time, roastAge, routes };
}

const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const range = ([a, b]: [number, number], unit: string): string => (a === b ? `${a}${unit}` : `${a}-${b}${unit}`);

// The profile as the few lines the AI is sent; "n" is how many brews a
// figure rests on. Parts the workspace keeps from the AI are already gone.
export function profileLines(p: Partial<BrewProfile> & Pick<BrewProfile, "brews" | "rating">): string[] {
  const lines = [`Rated brews by this barista: ${p.brews}, mean rating ${p.rating}.`];
  if (p.best) {
    const parts = [p.best.tdsPercent && `TDS ${range(p.best.tdsPercent, "%")}`, p.best.extractionYieldPercent && `EY ${range(p.best.extractionYieldPercent, "%")}`].filter(Boolean);
    lines.push(`Their ${p.best.methodKind} brews rated ${BEST_RATING}+ (n=${p.best.brews}): ${parts.join(", ")}.`);
  }
  if (p.temp) {
    const on = p.temp.roastLevel ? `${p.temp.brewer}, ${p.temp.roastLevel} roasts` : p.temp.brewer;
    lines.push(`Rating by kettle temperature on ${on}: ${p.temp.byTempC.map((b) => `${b.at} °C ${b.rating} (n=${b.brews})`).join("; ")}.`);
  }
  if (p.time) lines.push(`Usual total time on ${p.time.recipe}, by dose: ${p.time.byDose.map((b) => `${b.doseGrams} g ${mmss(b.medianSec)} (n=${b.brews})`).join("; ")}.`);
  if (p.roastAge) lines.push(`Rating by roast age, this coffee: ${p.roastAge.byWeek.map((b) => `${b.at}-${b.at + 6} d ${b.rating} (n=${b.brews})`).join("; ")}.`);
  if (p.routes) {
    const vs = p.routes.otherRating === null ? "" : ` (their other brews since: ${p.routes.otherRating})`;
    const recent = p.routes.recent.map((r) => `"${r.label}" ${r.rating}`).join("; ");
    lines.push(`Brews made from earlier suggested routes: n=${p.routes.brews}, mean rating ${p.routes.rating}${vs}. Latest: ${recent}.`);
  }
  return lines;
}
