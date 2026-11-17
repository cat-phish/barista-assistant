// A recap's figures (docs/api/recaps.md §11c): one week or month of brews, from
// the Insights rows (docs/api/stats.md §11, counted as "How the client
// counts" says), with the period before it for comparison.
import type { RoastLevel, StatsData, UserPreferences } from '../api/types';
import { beanLabel } from './beans';
import { caffeineSummary } from './caffeine';
import { brewShares, forOthers, ME, myShare, UNNAMED } from './shares';
import { brewerRetentions, brewVolumeMl, countBy, localDay } from './stats';
import { daysAfter, justEnded, type RecapKind, type RecapPeriod } from './recapPeriods';

export interface RecapBest {
  brewId: string;
  rating: number;
  day: string;
  bean: string;
  recipe: string | null;
  brewer: string | null;
}
export interface RecapFigures {
  brews: number;
  previousBrews: number;
  daysBrewed: number;
  rating: { mean: number; n: number } | null; // the coffee rating, as Insights averages it
  previousRating: number | null;
  best: RecapBest[]; // the top-rated brews, ties kept, up to 3
  caffeineMg: number | null;
  volume: { ml: number; estimated: boolean } | null; // your share (lib/shares.ts); estimated: some of it is an estimate (shown with ≈)
  // Brews made at least partly for guests, their share of the volume, and
  // who they were (named guests most brewed for first, unnamed ones last).
  forOthers: { brews: number; ml: number; estimated: boolean; guests: Array<{ name: string; brews: number }> } | null;
  coffeeGrams: number;
  beansBrewed: Array<{ id: string; label: string; brews: number }>; // most brewed first
  beansAdded: Array<{ id: string; label: string }>; // bought (or added) in the period
  beansFinished: Array<{ id: string; label: string }>; // archived in the period
  newRecipes: Array<{ id: string; name: string }>;
  topRecipe: { name: string; brews: number } | null;
  topBrewer: { name: string; brews: number } | null;
}

const within = (day: string, p: RecapPeriod): boolean => day >= p.start && day <= p.end;
const BEST_MAX = 3;

// data: the period's rows (any filters, e.g. only mine); previous: the period
// before's, for the comparison. today caps the caffeine's days, as Insights does.
export function recapFigures(data: StatsData, previous: StatsData | null, period: RecapPeriod, recipeRoastLevel: RoastLevel, today: string): RecapFigures {
  const brews = data.brews.filter((b) => within(localDay(b), period));
  const bean = (id: string) => data.beans.find((b) => b.id === id);
  const name = <T extends { id: string; name: string }>(list: readonly T[], id: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? null) : null);
  const label = (id: string) => {
    const b = bean(id);
    return b ? beanLabel(b) : 'Unknown bean';
  };

  const rated = brews.filter((b) => b.rating !== null);
  const mean = (list: typeof rated) => (list.length ? list.reduce((n, b) => n + b.rating!, 0) / list.length : null);
  const prevRated = (previous?.brews ?? []).filter((b) => b.rating !== null);
  const top = rated.length ? Math.max(...rated.map((b) => b.rating!)) : null;
  const best = rated
    .filter((b) => b.rating === top)
    .slice(-BEST_MAX)
    .reverse()
    .map((b) => ({ brewId: b.id, rating: b.rating!, day: localDay(b), bean: label(b.beanId), recipe: name(data.lookups.recipes, b.recipeId), brewer: name(data.lookups.brewers, b.brewerId) }));

  const retentions = brewerRetentions(data.lookups.brewers);
  const volumeOf = (b: (typeof brews)[number]) => brewVolumeMl(b, bean(b.beanId)?.roastLevel ?? null, recipeRoastLevel, b.brewerId ? (retentions.get(b.brewerId) ?? null) : null);
  const volumes = brews.flatMap((b) => {
    const v = volumeOf(b);
    return v ? [{ ...v, share: myShare(b) }] : [];
  });
  const drunk = volumes.filter((v) => v.share > 0);
  const volume = drunk.length ? { ml: drunk.reduce((n, v) => n + v.ml * v.share, 0), estimated: drunk.some((v) => v.source === 'estimate') } : null;
  const caffeine = caffeineSummary(brews, bean, { from: period.start, to: period.end }, today, myShare);

  const guestBrews = brews.filter(forOthers);
  const guestVolumes = guestBrews.flatMap((b) => {
    const v = volumeOf(b);
    return v ? [{ ...v, share: 1 - myShare(b) }] : [];
  });
  const guestName = (id: string) => data.lookups.guests.find((g) => g.id === id)?.name ?? 'Removed guest';
  const guestCounts = countBy(guestBrews, (b) => [...brewShares(b).keys()].filter((k) => k !== ME));
  const forOthersFigures = guestBrews.length
    ? {
        brews: guestBrews.length,
        ml: guestVolumes.reduce((n, v) => n + v.ml * v.share, 0),
        estimated: guestVolumes.some((v) => v.source === 'estimate'),
        guests: [...guestCounts.filter((c) => c.key !== UNNAMED).map((c) => ({ name: guestName(c.key), brews: c.n })), ...guestCounts.filter((c) => c.key === UNNAMED).map((c) => ({ name: 'Other guests', brews: c.n }))],
      }
    : null;

  const top1 = (counts: Array<{ key: string; n: number }>, list: ReadonlyArray<{ id: string; name: string }>) => {
    const c = counts[0];
    return c ? { name: name(list, c.key) ?? 'Unknown', brews: c.n } : null;
  };
  const beanCounts = countBy(brews, (b) => b.beanId);
  const day = (iso: string) => iso.slice(0, 10);

  return {
    brews: brews.length,
    previousBrews: previous?.brews.length ?? 0,
    daysBrewed: new Set(brews.map(localDay)).size,
    rating: rated.length ? { mean: mean(rated)!, n: rated.length } : null,
    previousRating: mean(prevRated),
    best,
    caffeineMg: caffeine?.totalMg ?? null,
    volume,
    forOthers: forOthersFigures,
    coffeeGrams: brews.reduce((n, b) => n + b.doseGrams, 0),
    beansBrewed: beanCounts.map((c) => ({ id: c.key, label: label(c.key), brews: c.n })),
    beansAdded: data.beans.filter((b) => within(b.purchaseDate ?? day(b.createdAt), period)).map((b) => ({ id: b.id, label: beanLabel(b) })),
    beansFinished: data.beans.filter((b) => b.archivedAt !== null && within(day(b.archivedAt), period)).map((b) => ({ id: b.id, label: beanLabel(b) })),
    newRecipes: data.lookups.recipes.filter((r) => within(day(r.createdAt), period)).map((r) => ({ id: r.id, name: r.name })),
    topRecipe: top1(countBy(brews, (b) => b.recipeId), data.lookups.recipes),
    topBrewer: top1(countBy(brews, (b) => b.brewerId), data.lookups.brewers),
  };
}

// The brew-page banner (recaps.md §11c, "Banner"): the periods just ended
// that it would announce, before checking they had any of your brews. Each
// shows from the day after it ends for recapBannerDays days, until opened
// or dismissed (recapSeen holds the last period start seen, per kind).
export type RecapBannerPrefs = Pick<UserPreferences, 'recaps' | 'recapPeriods' | 'weekStartsOn' | 'recapBanner' | 'recapBannerDays' | 'recapSeen'>;
export interface RecapDue {
  kind: RecapKind;
  period: RecapPeriod;
}
export function recapsDue(prefs: RecapBannerPrefs, today: string): RecapDue[] {
  if (!prefs.recaps || !prefs.recapBanner) return [];
  const kinds: RecapKind[] = prefs.recapPeriods === 'both' ? ['weekly', 'monthly'] : [prefs.recapPeriods];
  return kinds
    .map((kind) => ({ kind, period: justEnded(kind, today, prefs.weekStartsOn) }))
    .filter(({ kind, period }) => daysAfter(period, today) <= prefs.recapBannerDays && (prefs.recapSeen[kind] ?? '') < period.start);
}
// What the banner says, given which due periods had brews; null: no banner.
export function bannerFor(prefs: RecapBannerPrefs, today: string, hadBrews: (due: RecapDue) => boolean): { due: RecapDue[]; text: string } | null {
  const due = recapsDue(prefs, today).filter(hadBrews);
  if (!due.length) return null;
  const text = due.length > 1 ? 'Your weekly and monthly recaps are ready.' : `Your ${due[0]!.kind} recap is ready.`;
  return { due, text };
}
// recapSeen after opening or dismissing these.
export function markSeen(seen: UserPreferences['recapSeen'], due: readonly RecapDue[]): UserPreferences['recapSeen'] {
  const out = { ...seen };
  for (const d of due) if ((out[d.kind] ?? '') < d.period.start) out[d.kind] = d.period.start;
  return out;
}
