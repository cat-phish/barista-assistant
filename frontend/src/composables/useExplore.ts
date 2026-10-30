// Explore's picks turned into fields (lib/explore.ts): for the Explore tab's
// own pickers and chart, and for an Explore chart added to a tab.
import { computed, type ComputedRef } from 'vue';
import type { StatsBrew } from '../api/types';
import { COLOR_BY, fieldLabel, GROUPS, NUMBERS, pickAxes, visible, type CategoryField, type ExploreContext, type ExploreField, type NumberField } from '../lib/explore';
import { countBy } from '../lib/stats';
import { VOLUME_LABELS } from '../lib/units';
import { useStats } from './useStats';

export interface ExplorePicks {
  x: string;
  y: string;
  color?: string;
  grinder?: string;
}

export function useExplore(picks: () => ExplorePicks) {
  const stats = useStats();
  const ctx = computed<ExploreContext>(() => ({
    bean: stats.bean,
    name: stats.name,
    volume: stats.volume,
    volumeIn: stats.volumeIn,
    volumeLabel: VOLUME_LABELS[stats.filters.value.unit],
  }));

  const numbers = computed(() => visible(NUMBERS, stats.hidden.value));
  const groups = computed(() => visible(GROUPS, stats.hidden.value));
  const colorFields = computed(() => visible(COLOR_BY, stats.hidden.value));

  const axes = computed(() => pickAxes(picks().x, picks().y, numbers.value, groups.value));
  const x: ComputedRef<ExploreField> = computed(() => axes.value.x);
  const y: ComputedRef<NumberField> = computed(() => axes.value.y);
  // The picks as asked, not fallen back: an added chart whose field is hidden
  // or gone isn't drawn.
  const exact = computed(() => x.value.key === picks().x && y.value.key === picks().y);
  const color = computed<CategoryField | null>(() => (x.value.kind === 'number' ? (colorFields.value.find((f) => f.key === picks().color) ?? null) : null));
  const label = (f: ExploreField) => fieldLabel(f, ctx.value);

  // Grind settings only compare on one grinder: the picked one, else the most used.
  const grinders = computed(() => countBy(stats.brews.value.filter((b) => b.grindSetting !== null), (b) => b.grinderId));
  const onGrind = computed(() => x.value.key === 'grind' || y.value.key === 'grind');
  const grinder = computed(() => (!onGrind.value ? null : (grinders.value.find((g) => g.key === picks().grinder)?.key ?? grinders.value[0]?.key ?? null)));
  const brews = computed<StatsBrew[]>(() => (grinder.value ? stats.brews.value.filter((b) => b.grinderId === grinder.value) : stats.brews.value));

  return { stats, ctx, numbers, groups, colorFields, x, y, exact, color, label, grinders, onGrind, grinder, brews };
}
