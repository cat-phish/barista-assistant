<script setup lang="ts">
// Insights → Recap (docs/api/recaps.md §11c): a week or month of brewing at a
// glance, with the period before for comparison. Its own period and
// Mine / Everyone switch, in the query (kind, start, mine=0), so a
// notification can link to one; the Insights filters don't apply. With
// recaps off (Settings → Recaps) it waits for "Show recap".
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { statsApi } from '../../api/stats';
import type { StatsData } from '../../api/types';
import { errorMessage } from '../../api/client';
import { usePreferences } from '../../composables/usePreferences';
import { useStats } from '../../composables/useStats';
import { formatCaffeine } from '../../lib/caffeine';
import { localDateInput } from '../../lib/format';
import { recapFigures } from '../../lib/recap';
import { justEnded, nextPeriod, periodLabel, periodOf, previousPeriod, type RecapKind } from '../../lib/recapPeriods';
import { formatWeight, localDay } from '../../lib/stats';
import { useWorkspaceStore } from '../../stores/workspace';

const route = useRoute();
const router = useRouter();
const workspaces = useWorkspaceStore();
const stats = useStats();
const { prefs, recipeRoastLevel } = usePreferences();

const today = localDateInput();
const str = (v: unknown) => (typeof v === 'string' ? v : '');
// The periods the person gets recaps for; both are always viewable here.
const kinds = computed<RecapKind[]>(() => (prefs.value.recapPeriods === 'monthly' ? ['monthly', 'weekly'] : ['weekly', 'monthly']));
const kind = computed<RecapKind>(() => (str(route.query.kind) === 'monthly' || str(route.query.kind) === 'weekly' ? (str(route.query.kind) as RecapKind) : kinds.value[0]!));
const weekStartsOn = computed(() => prefs.value.weekStartsOn);
const current = computed(() => periodOf(kind.value, today, weekStartsOn.value));
// The period shown: the one ?start falls in, else the last whole one; never past this one.
const period = computed(() => {
  const start = str(route.query.start);
  const p = /^\d{4}-\d{2}-\d{2}$/.test(start) ? periodOf(kind.value, start, weekStartsOn.value) : justEnded(kind.value, today, weekStartsOn.value);
  return p.start > current.value.start ? current.value : p;
});
const previous = computed(() => previousPeriod(kind.value, period.value, weekStartsOn.value));
const inProgress = computed(() => period.value.start === current.value.start);
const mine = computed(() => route.query.mine !== '0');
const noun = computed(() => (kind.value === 'weekly' ? 'week' : 'month'));

function go(change: { kind?: RecapKind; start?: string; mine?: boolean }): void {
  const k = change.kind ?? kind.value;
  const query: Record<string, string> = { kind: k };
  if (change.start ?? (change.kind ? undefined : period.value.start)) query.start = change.start ?? period.value.start;
  if (!(change.mine ?? mine.value)) query.mine = '0';
  void router.replace({ query });
}
const step = (dir: -1 | 1) => go({ start: (dir < 0 ? previousPeriod : nextPeriod)(kind.value, period.value, weekStartsOn.value).start });

// One request covers the period and the one before it.
const asked = ref(prefs.value.recaps);
const data = ref<StatsData | null>(null);
const loading = ref(false);
const error = ref('');
let request = 0;
async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !asked.value) return;
  const n = ++request;
  loading.value = true;
  error.value = '';
  try {
    const res = await statsApi.get(ws, { from: previous.value.start, to: period.value.end, mine: mine.value });
    if (n === request) data.value = res;
  } catch (err) {
    if (n === request) error.value = errorMessage(err);
  } finally {
    if (n === request) loading.value = false;
  }
}
watch([() => period.value.start, kind, mine, asked], () => void load(), { immediate: true });

const figures = computed(() => {
  const d = data.value;
  if (!d) return null;
  const inPrev = (day: string) => day >= previous.value.start && day <= previous.value.end;
  const prev = { ...d, brews: d.brews.filter((b) => inPrev(localDay(b))) };
  return recapFigures(d, prev, period.value, recipeRoastLevel.value, today);
});
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const stars = (r: number) => `${r % 1 ? r.toFixed(1) : r} ★`;
const brewsSub = computed(() => {
  const f = figures.value;
  if (!f) return '';
  const was = `${f.previousBrews} the ${noun.value} before`;
  return f.brews ? `on ${plural(f.daysBrewed, 'day')} · ${was}` : was;
});
const ratingSub = computed(() => {
  const f = figures.value;
  if (!f?.rating) return '';
  return `from ${plural(f.rating.n, 'rated brew')}${f.previousRating !== null ? ` · was ${f.previousRating.toFixed(1)}` : ''}`;
});
</script>

<template>
  <div class="recap stack">
    <div class="recap-bar">
      <div class="seg" role="group" aria-label="Recap period">
        <button v-for="k in kinds" :key="k" type="button" class="btn" :class="k === kind ? 'btn-primary' : 'btn-secondary'" :aria-pressed="k === kind" @click="go({ kind: k })">
          {{ k === 'weekly' ? 'Weekly' : 'Monthly' }}
        </button>
      </div>
      <div class="nav">
        <button type="button" class="btn btn-secondary" :aria-label="`Previous ${noun}`" @click="step(-1)">‹</button>
        <h2 class="period">{{ periodLabel(kind, period) }}<span v-if="inProgress" class="muted"> (so far)</span></h2>
        <button type="button" class="btn btn-secondary" :aria-label="`Next ${noun}`" :disabled="inProgress" @click="step(1)">›</button>
      </div>
      <label class="mine"><input type="checkbox" :checked="mine" @change="go({ mine: ($event.target as HTMLInputElement).checked })" /> Only my brews</label>
    </div>

    <div v-if="!asked" class="card ask">
      <p>Recaps are off in <RouterLink :to="{ name: 'settings-recaps' }">Settings → Recaps</RouterLink>, so nothing loads until you ask.</p>
      <button type="button" class="btn btn-primary" @click="asked = true">Show recap</button>
    </div>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-else-if="loading && !figures" class="muted" aria-live="polite">Loading the recap…</p>
    <template v-else-if="figures">
      <p v-if="!figures.brews" class="card empty">No brews {{ inProgress ? `this ${noun} yet` : `in this ${noun}` }}{{ mine ? ' by you' : '' }}.</p>
      <div class="tiles" :class="{ stale: loading }">
        <section class="card tile">
          <h3>Brews</h3>
          <p class="value">{{ figures.brews }}</p>
          <p class="muted sub">{{ brewsSub }}</p>
        </section>
        <section v-if="figures.rating" class="card tile">
          <h3>Average rating</h3>
          <p class="value">{{ figures.rating.mean.toFixed(1) }} / 5</p>
          <p class="muted sub">{{ ratingSub }}</p>
        </section>
        <section v-if="figures.caffeineMg !== null" class="card tile">
          <h3>Caffeine</h3>
          <p class="value">{{ formatCaffeine(figures.caffeineMg) }}</p>
        </section>
        <section v-if="figures.volume" class="card tile">
          <h3>Volume drunk</h3>
          <p class="value">{{ figures.volume.estimated ? '≈ ' : '' }}{{ stats.formatVolume(figures.volume.ml) }}</p>
        </section>
        <section v-if="figures.brews" class="card tile">
          <h3>Coffee used</h3>
          <p class="value">{{ formatWeight(figures.coffeeGrams) }}</p>
        </section>
        <section v-if="figures.topRecipe" class="card tile">
          <h3>Most brewed</h3>
          <p class="value small-value">{{ figures.topRecipe.name }}</p>
          <p class="muted sub">{{ plural(figures.topRecipe.brews, 'brew') }}<template v-if="figures.topBrewer"> · mostly on the {{ figures.topBrewer.name }}</template></p>
        </section>
      </div>

      <section v-if="figures.best.length" class="card stack-sm">
        <h3>Best {{ figures.best.length === 1 ? 'brew' : 'brews' }}</h3>
        <ul class="plain">
          <li v-for="b in figures.best" :key="b.brewId">
            <RouterLink :to="{ name: 'journal-entry', params: { id: b.brewId } }">{{ stars(b.rating) }} {{ b.bean }}</RouterLink>
            <span class="muted"><template v-if="b.recipe"> · {{ b.recipe }}</template><template v-if="b.brewer"> on the {{ b.brewer }}</template></span>
          </li>
        </ul>
      </section>

      <section v-if="figures.beansBrewed.length || figures.beansAdded.length || figures.beansFinished.length || figures.newRecipes.length" class="card stack-sm">
        <h3>Beans and recipes</h3>
        <p v-if="figures.beansBrewed.length"><strong>Brewed:</strong> {{ figures.beansBrewed.map((b) => `${b.label} (${b.brews})`).join(', ') }}</p>
        <p v-if="figures.beansAdded.length"><strong>New beans:</strong> {{ figures.beansAdded.map((b) => b.label).join(', ') }}</p>
        <p v-if="figures.beansFinished.length"><strong>Finished:</strong> {{ figures.beansFinished.map((b) => b.label).join(', ') }}</p>
        <p v-if="figures.newRecipes.length"><strong>New recipes:</strong> {{ figures.newRecipes.map((r) => r.name).join(', ') }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.recap-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
}
.seg {
  display: flex;
  gap: var(--space-1);
}
.nav {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.period {
  margin: 0;
  font-size: 1.05rem;
  min-width: 9rem;
  text-align: center;
}
.mine {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.ask,
.empty {
  margin: 0;
}
.ask p {
  margin: 0 0 var(--space-2);
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-3);
}
.tile {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
h3 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.value {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.small-value {
  font-size: 1.1rem;
}
.sub {
  margin: 0;
  font-size: 0.85rem;
}
.stack-sm {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.stack-sm p {
  margin: 0;
}
.plain {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.stale {
  opacity: 0.6;
}
</style>
