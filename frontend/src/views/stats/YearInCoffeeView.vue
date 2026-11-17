<script setup lang="ts">
// Your Year in Coffee (backlog 65, docs/api/recaps.md §11c): a calendar year
// as full-screen story slides, one figure each. Tap the right of a slide or
// swipe left for the next, the left or a swipe right to go back; arrow keys
// too, Escape closes. Query: year (default the one just ended, or this one
// "so far" from 1 December) and mine=0 for the bar's year.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { statsApi } from '../../api/stats';
import type { StatsData } from '../../api/types';
import { errorMessage } from '../../api/client';
import { usePreferences } from '../../composables/usePreferences';
import { useStats } from '../../composables/useStats';
import { localDateInput } from '../../lib/format';
import { formatWeight, localDay } from '../../lib/stats';
import { latestYear, yearFigures, yearPeriod } from '../../lib/yearInCoffee';
import { MONTH_NAMES, personLabels, yearSlides } from '../../lib/yearSlides';
import { useAuthStore } from '../../stores/auth';
import { useWorkspaceStore } from '../../stores/workspace';

const route = useRoute();
const router = useRouter();
const workspaces = useWorkspaceStore();
const auth = useAuthStore();
const stats = useStats();
const { prefs, recipeRoastLevel } = usePreferences();

const today = localDateInput();
const latest = latestYear(today);
const year = computed(() => {
  const y = Number(route.query.year);
  return Number.isInteger(y) && y >= 2000 && y <= latest ? y : latest;
});
const mine = computed(() => route.query.mine !== '0');
const inProgress = computed(() => year.value === Number(today.slice(0, 4)));

function go(change: { year?: number; mine?: boolean }): void {
  const query: Record<string, string> = { year: String(change.year ?? year.value) };
  if (!(change.mine ?? mine.value)) query.mine = '0';
  index.value = 0;
  void router.replace({ query });
}
function close(): void {
  if (window.history.state?.back) router.back();
  else void router.push({ name: 'stats-recap' });
}

// One request covers the year and the one before it.
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
    const res = await statsApi.get(ws, { from: yearPeriod(year.value - 1).start, to: yearPeriod(year.value).end, mine: mine.value });
    if (n === request) data.value = res;
  } catch (err) {
    if (n === request) error.value = errorMessage(err);
  } finally {
    if (n === request) loading.value = false;
  }
}
watch([year, mine, asked, () => workspaces.current?.id], () => void load(), { immediate: true });

const slides = computed(() => {
  const d = data.value;
  if (!d) return [];
  const before = yearPeriod(year.value - 1);
  const prev = { ...d, brews: d.brews.filter((b) => localDay(b) >= before.start && localDay(b) <= before.end) };
  const f = yearFigures(d, prev, year.value, recipeRoastLevel.value, today);
  const person = personLabels(f.people, auth.user?.id ?? null);
  return yearSlides(f, { mine: mine.value, inProgress: inProgress.value, volume: (ml) => stats.formatVolume(ml), weight: formatWeight, person });
});

const index = ref(0);
watch(slides, (s) => {
  if (index.value >= s.length) index.value = Math.max(0, s.length - 1);
});
const slide = computed(() => slides.value[index.value] ?? null);
const last = computed(() => index.value >= slides.value.length - 1);
const direction = ref<'next' | 'back'>('next');
function move(by: 1 | -1): void {
  const to = index.value + by;
  if (to < 0 || to >= slides.value.length) return;
  direction.value = by > 0 ? 'next' : 'back';
  index.value = to;
}

// Taps and swipes on the slide.
let downX: number | null = null;
let downY = 0;
function onDown(e: PointerEvent): void {
  downX = e.clientX;
  downY = e.clientY;
}
function onUp(e: PointerEvent): void {
  if (downX === null) return;
  const dx = e.clientX - downX;
  const dy = e.clientY - downY;
  downX = null;
  if ((e.target as HTMLElement).closest('a, button, label, input')) return;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) return move(dx < 0 ? 1 : -1);
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    move(e.clientX - box.left < box.width / 3 ? -1 : 1);
  }
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowRight' || e.key === 'PageDown') move(1);
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') move(-1);
  else if (e.key === 'Escape') close();
  else return;
  e.preventDefault();
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

const maxBar = computed(() => Math.max(1, ...(slide.value?.bars ?? [])));
const barsLabel = computed(() => (slide.value?.bars ?? []).map((n, i) => `${MONTH_NAMES[i]}: ${n}`).join(', '));
</script>

<template>
  <div class="year" role="dialog" aria-modal="true" :aria-label="`${mine ? 'Your' : 'The bar\'s'} ${year} in coffee`">
    <div class="top">
      <div class="progress" aria-hidden="true">
        <span v-for="(s, i) in slides" :key="s.key" class="seg" :class="{ done: i < index, now: i === index }" />
      </div>
      <div class="bar">
        <label class="mine"><input type="checkbox" :checked="mine" @change="go({ mine: ($event.target as HTMLInputElement).checked })" /> Only my brews</label>
        <button type="button" class="icon" aria-label="Close" @click="close">✕</button>
      </div>
    </div>

    <div v-if="!asked" class="stage center">
      <p>Recaps are off in <RouterLink :to="{ name: 'settings-recaps' }">Settings → Recaps</RouterLink>, so nothing loads until you ask.</p>
      <button type="button" class="btn btn-primary" @click="asked = true">Show my year</button>
    </div>
    <p v-else-if="error" class="stage center form-error" role="alert">{{ error }}</p>
    <p v-else-if="!slide" class="stage center" aria-live="polite">Loading your year…</p>
    <div v-else class="stage" :class="{ stale: loading }" @pointerdown="onDown" @pointerup="onUp">
      <Transition :name="direction" mode="out-in">
        <section :key="`${year}-${mine}-${slide.key}`" class="slide" :class="`slide-${slide.key}`" aria-live="polite">
          <p class="kicker">{{ slide.kicker }}</p>
          <p class="value" :class="{ long: slide.value.length > 18 }">{{ slide.value }}</p>
          <p v-if="slide.sub" class="sub">{{ slide.sub }}</p>
          <div v-if="slide.bars" class="bars" role="img" :aria-label="barsLabel">
            <span v-for="(n, i) in slide.bars" :key="i" class="col">
              <span class="fill" :style="{ height: `${(n / maxBar) * 100}%` }" />
              <span class="m">{{ MONTH_NAMES[i]!.charAt(0) }}</span>
            </span>
          </div>
          <ol v-if="slide.list?.length" class="list" :class="{ summary: slide.key === 'summary' }">
            <li v-for="item in slide.list" :key="item.name">
              <span class="name">{{ item.name }}</span><span class="detail">{{ item.detail }}</span>
            </li>
          </ol>
          <RouterLink v-if="slide.link" :to="slide.link" class="btn btn-secondary">Open the brew</RouterLink>
          <div v-if="slide.key === 'summary'" class="years">
            <button type="button" class="btn btn-secondary" @click="go({ year: year - 1 })">‹ {{ year - 1 }}</button>
            <button v-if="year < latest" type="button" class="btn btn-secondary" @click="go({ year: year + 1 })">{{ year + 1 }} ›</button>
          </div>
        </section>
      </Transition>
    </div>

    <div v-if="slide" class="foot">
      <button type="button" class="btn btn-secondary" :disabled="index === 0" aria-label="Previous slide" @click="move(-1)">‹</button>
      <span class="count" aria-live="polite">{{ index + 1 }} / {{ slides.length }}</span>
      <button v-if="!last" type="button" class="btn btn-primary" aria-label="Next slide" @click="move(1)">›</button>
      <button v-else type="button" class="btn btn-primary" @click="close">Done</button>
    </div>
  </div>
</template>

<style scoped>
.year {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: linear-gradient(160deg, var(--brand-tint), var(--bg) 60%);
  color: var(--text);
  padding: max(12px, env(safe-area-inset-top)) 16px max(12px, env(safe-area-inset-bottom));
}
.top {
  display: grid;
  gap: 8px;
}
.progress {
  display: flex;
  gap: 4px;
}
.seg {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
}
.seg.done,
.seg.now {
  background: var(--brand);
}
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mine {
  display: flex;
  gap: 6px;
  align-items: center;
}
.icon {
  border: 0;
  background: none;
  color: var(--text);
  font-size: 1.25rem;
  min-width: var(--tap, 44px);
  min-height: var(--tap, 44px);
  cursor: pointer;
}
.stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  user-select: none;
  touch-action: pan-y;
}
.stage.center {
  flex-direction: column;
  gap: 12px;
  text-align: center;
}
.stale {
  opacity: 0.6;
}
.slide {
  width: 100%;
  max-width: 32rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}
.kicker {
  margin: 0;
  font-size: 1.1rem;
  color: var(--text-muted);
}
.value {
  margin: 0;
  font-size: clamp(2.25rem, 10vw, 4rem);
  font-weight: 700;
  line-height: 1.1;
  color: var(--brand);
  overflow-wrap: anywhere;
}
.value.long {
  font-size: clamp(1.75rem, 7vw, 2.75rem);
}
.sub {
  margin: 0;
  font-size: 1.1rem;
}
.bars {
  display: flex;
  gap: 4px;
  align-items: flex-end;
  height: 120px;
  width: 100%;
}
.col {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}
.fill {
  width: 100%;
  min-height: 2px;
  border-radius: 3px 3px 0 0;
  background: var(--brand);
}
.m {
  font-size: 0.75rem;
  color: var(--text-muted);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  display: grid;
  gap: 6px;
}
.list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  text-align: left;
}
.list .detail {
  color: var(--text-muted);
  white-space: nowrap;
}
.list.summary .detail {
  color: var(--text);
  font-weight: 600;
  white-space: normal;
  text-align: right;
}
.years {
  display: flex;
  gap: 8px;
}
.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.count {
  color: var(--text-muted);
}
.next-enter-active,
.next-leave-active,
.back-enter-active,
.back-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.next-enter-from,
.back-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
.next-leave-to,
.back-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}
@media (prefers-reduced-motion: reduce) {
  .next-enter-active,
  .next-leave-active,
  .back-enter-active,
  .back-leave-active {
    transition: none;
  }
}
</style>
