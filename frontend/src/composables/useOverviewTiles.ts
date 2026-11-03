// The Overview's tiles (docs/api/stats.md §11, "How the client counts"): the
// headline totals for the filtered brews, and the bean shelf as it is now.
// Drawn on the Overview, and attached to chats as "Overview totals".
import { computed, type ComputedRef } from 'vue';
import { beanLabel, formatPrice } from '../lib/beans';
import { caffeineSummary, formatCaffeine } from '../lib/caffeine';
import { localDateInput } from '../lib/format';
import { countBy, formatDuration, formatWeight, freezeState, isAvailable, localDay, longestStreak, spendByCurrency } from '../lib/stats';
import { useStats } from './useStats';

export interface Tile {
  key: string; // its layout id is tile.<key>
  label: string;
  value: string;
  sub?: string;
}

export function useOverviewTiles(): ComputedRef<Tile[]> {
  const stats = useStats();
  return computed<Tile[]>(() => {
    if (!stats.data.value) return [];
    const brews = stats.brews.value;
    const beans = stats.beans.value;
    const lookups = stats.data.value.lookups;
    const distinct = (ids: Array<string | null>) => new Set(ids.filter((id): id is string => id !== null)).size;
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

    const dose = brews.reduce((sum, b) => sum + b.doseGrams, 0);
    const volumes = brews.map((b) => stats.volume(b)).filter((v) => v !== null);
    const ml = volumes.reduce((sum, v) => sum + v.ml, 0);
    const estimated = volumes.filter((v) => v.source === 'estimate').length;
    const rated = brews.filter((b) => b.rating !== null);
    const meanRating = rated.length ? rated.reduce((sum, b) => sum + b.rating!, 0) / rated.length : null;

    const caffeine = caffeineSummary(brews, stats.bean, stats.range.value, localDateInput());

    const available = beans.filter(isAvailable);
    const states = countBy(available, freezeState);
    const stateCount = (s: string) => states.find((c) => c.key === s)?.n ?? 0;

    const { from, to } = stats.range.value;
    const spentOn = stats.filters.value.bean ? beans.filter((b) => b.id === stats.filters.value.bean) : beans;
    const spend = spendByCurrency(spentOn, from ?? undefined, to ?? undefined);

    const top = countBy(brews, (b) => b.beanId)[0];
    const topBean = top ? stats.bean(top.key) : undefined;

    return [
      { key: 'brews', label: 'Brews', value: String(brews.length), sub: rated.length ? `${rated.length} rated` : undefined },
      { key: 'coffee', label: 'Coffee used', value: formatWeight(dose), sub: brews.length ? `${formatWeight(dose / brews.length)} a brew` : undefined },
      { key: 'volume', label: 'Volume drunk', value: `${estimated ? '≈ ' : ''}${stats.formatVolume(ml)}`, sub: estimated ? `${Math.round((estimated / volumes.length) * 100)}% estimated` : undefined },
      { key: 'caffeineTotal', label: 'Caffeine Total', value: caffeine ? formatCaffeine(caffeine.totalMg) : '–' },
      { key: 'caffeinePerBrew', label: 'Caffeine/Brew', value: caffeine ? formatCaffeine(caffeine.perBrewMg) : '–', sub: caffeine ? `from ${plural(brews.length, 'brew')}` : undefined },
      { key: 'caffeinePerDay', label: 'Caffeine/Day', value: caffeine ? formatCaffeine(caffeine.perDayMg) : '–', sub: caffeine ? `over ${plural(caffeine.days, 'day')}` : undefined },
      { key: 'time', label: 'Total brew time', value: formatDuration(brews.reduce((sum, b) => sum + b.timeSec, 0)) },
      { key: 'rating', label: 'Average rating', value: meanRating === null ? '–' : `${meanRating.toFixed(1)} / 5`, sub: rated.length ? `from ${plural(rated.length, 'brew')}` : undefined },
      { key: 'beans', label: 'Beans explored', value: String(distinct(brews.map((b) => b.beanId))), sub: `of ${plural(beans.length, 'bean')}` },
      {
        key: 'available', label: 'Beans available',
        value: String(available.length),
        sub: available.length ? `${stateCount('frozen')} frozen · ${stateCount('thawed')} thawed · ${stateCount('fresh')} fresh` : 'none in stock',
      },
      {
        key: 'spend', label: 'Money spent on beans',
        value: spend[0] ? formatPrice(spend[0].amount, spend[0].currency) : '–',
        sub: spend.length > 1 ? spend.slice(1).map((s) => `+ ${formatPrice(s.amount, s.currency)}`).join(' ') : spend[0] ? plural(spend[0].bags, 'bag') : 'no prices recorded',
      },
      { key: 'grinders', label: 'Grinders used', value: String(distinct(brews.map((b) => b.grinderId))), sub: `${lookups.grinders.length} in Bar setup` },
      { key: 'methods', label: 'Brew methods used', value: String(distinct(brews.map((b) => b.methodId))), sub: plural(distinct(brews.map((b) => b.recipeId)), 'recipe') },
      { key: 'tools', label: 'Prep tools used', value: String(new Set(brews.flatMap((b) => b.toolIds)).size) },
      { key: 'photos', label: 'Bean photos', value: String(beans.reduce((sum, b) => sum + b.photoCount, 0)) },
      { key: 'streak', label: 'Longest streak', value: plural(longestStreak(brews.map(localDay)), 'day'), sub: 'brewing every day' },
      { key: 'topBean', label: 'Most brewed bean', value: topBean ? beanLabel(topBean) : '–', sub: top ? plural(top.n, 'brew') : undefined },
    ];
  });
}
