<script setup lang="ts">
// Your Year in Coffee (backlog 65, docs/api/recaps.md §11c): a calendar year
// as full-screen story slides, one figure each. Tap the right of a slide or
// swipe left for the next, the left or a swipe right to go back; arrow keys
// too, Escape closes. Query: year (default the one just ended, or this one
// "so far" from 1 December) and mine=0 for the bar's year. Outside the
// Insights layout, so it can't use useStats().
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { statsApi } from '../../api/stats';
import { membersApi } from '../../api/members';
import type { Member, StatsData } from '../../api/types';
import { errorMessage } from '../../api/client';
import { usePreferences } from '../../composables/usePreferences';
import { localDateInput } from '../../lib/format';
import { formatWeight, localDay } from '../../lib/stats';
import { countFrame, splitNumber } from '../../lib/countUp';
import { formatVolumeIn } from '../../lib/units';
import { SONG_VOLUME, songSource } from '../../lib/yearSong';
import { latestYear, yearFigures, yearPeriod } from '../../lib/yearInCoffee';
import { MONTH_NAMES, personLabels, yearSlides } from '../../lib/yearSlides';
import { useAuthStore } from '../../stores/auth';
import { useWorkspaceStore } from '../../stores/workspace';

const route = useRoute();
const router = useRouter();
const workspaces = useWorkspaceStore();
const auth = useAuthStore();
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
function leave(): void {
  if (window.history.state?.back) router.back();
  else void router.push({ name: 'stats-recap' });
}
// The song fades out rather than cutting off.
const FADE_MS = 600;
function close(): void {
  const a = audio.value;
  if (!a || a.paused) return leave();
  const from = a.volume;
  const started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / FADE_MS);
    a.volume = from * (1 - t);
    if (t < 1) requestAnimationFrame(step);
    else leave();
  };
  requestAnimationFrame(step);
}

// Music (docs/api/recaps.md §11c "Motion and sound"): off until picked. A
// browser plays sound only after a tap, so a remembered choice starts on the
// first tap or key; it pauses while the tab is hidden.
const audio = ref<HTMLAudioElement | null>(null);
const song = computed(() => prefs.value.yearSong);
const uploadsOn = computed(() => auth.user?.features.yearSongUploads ?? false);
const ownSong = computed(() => auth.user?.song ?? null);
const songUrl = computed(() => {
  const url = songSource(song.value, uploadsOn.value, Boolean(ownSong.value));
  // A replaced song has the same address, so the upload time tells them apart.
  return url && song.value === 'own' ? `${url}?v=${encodeURIComponent(ownSong.value!.uploadedAt)}` : url;
});

// Your own song (docs/api/auth.md §1, "Year song"): 10 MB, checked again by the server.
const SONG_MAX_MB = 10;
const songInput = ref<HTMLInputElement | null>(null);
const songBusy = ref(false);
const songError = ref('');
async function onSongFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  songError.value = '';
  if (file.size > SONG_MAX_MB * 1024 * 1024) {
    songError.value = `That file is over ${SONG_MAX_MB} MB.`;
    return;
  }
  songBusy.value = true;
  try {
    audio.value?.pause();
    await auth.uploadSong(file);
    await nextTick();
    play();
  } catch (err) {
    songError.value = errorMessage(err);
  } finally {
    songBusy.value = false;
  }
}
async function removeOwnSong(): Promise<void> {
  songError.value = '';
  try {
    await auth.removeSong();
  } catch (err) {
    songError.value = errorMessage(err);
  }
}
function play(): void {
  const a = audio.value;
  if (!a || !songUrl.value || !a.paused || document.hidden) return;
  a.volume = SONG_VOLUME;
  void a.play().catch(() => undefined); // still locked: the next tap tries again
}
async function pickSong(e: Event): Promise<void> {
  const value = (e.target as HTMLSelectElement).value as typeof song.value;
  await auth.setPreferences({ yearSong: value }).catch(() => undefined);
  await nextTick(); // the new src first
  play();
}
watch(songUrl, (url) => {
  if (!url) audio.value?.pause();
});
function onVisibility(): void {
  if (document.hidden) audio.value?.pause();
  else play();
}

// One request covers the year and the one before it.
const asked = ref(prefs.value.recaps);
const data = ref<StatsData | null>(null);
const members = ref<Member[]>([]); // for names on the bar's year
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
    const [res, list] = await Promise.all([
      statsApi.get(ws, { from: yearPeriod(year.value - 1).start, to: yearPeriod(year.value).end, mine: mine.value }),
      mine.value ? Promise.resolve(members.value) : membersApi.list(ws).then((r) => r.members),
    ]);
    if (n !== request) return;
    data.value = res;
    members.value = list;
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
  const person = personLabels(f.people, auth.user?.id ?? null, (id) => members.value.find((m) => m.userId === id)?.name ?? null);
  return yearSlides(f, { mine: mine.value, inProgress: inProgress.value, volume: (ml) => formatVolumeIn(ml, prefs.value.volumeUnit), weight: formatWeight, person });
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
  play();
  if (e.key === 'ArrowRight' || e.key === 'PageDown') move(1);
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') move(-1);
  else if (e.key === 'Escape') close();
  else return;
  e.preventDefault();
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', play);
  document.addEventListener('visibilitychange', onVisibility);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('pointerdown', play);
  document.removeEventListener('visibilitychange', onVisibility);
});

// Motion (docs/api/recaps.md §11c "Motion and sound"): the slide's number
// counts up; bars, list rows and confetti are CSS. Reduced motion: none.
const COUNT_MS = 900;
const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const shownValue = ref('');
let frame = 0;
watch(
  slide,
  (s) => {
    cancelAnimationFrame(frame);
    const parts = s && s.key !== 'intro' && !still ? splitNumber(s.value) : null;
    if (!s || !parts) {
      shownValue.value = s?.value ?? '';
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const t = (now - started) / COUNT_MS;
      shownValue.value = parts.before + countFrame(parts.token, t) + parts.after;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    tick(started);
  },
  { immediate: true },
);
onBeforeUnmount(() => cancelAnimationFrame(frame));

// The same scatter every time, so it doesn't change on re-render.
const confetti = Array.from({ length: 30 }, (_, i) => ({
  x: (i * 37) % 100,
  delay: ((i * 53) % 20) * 60,
  drift: ((i * 29) % 40) - 20,
  spin: ((i * 71) % 360) - 180,
  tone: i % 3,
}));

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
        <span class="tools">
          <label class="music">
            <span aria-hidden="true">♪</span>
            <select :value="song" aria-label="Music" @change="pickSong">
              <option value="off">No music</option>
              <option value="builtin">Built-in song</option>
              <option v-if="uploadsOn" value="own">My song</option>
            </select>
          </label>
          <button type="button" class="icon" aria-label="Close" @click="close">✕</button>
        </span>
      </div>
    </div>

    <div v-if="uploadsOn && song === 'own' && (index === 0 || !ownSong || songError)" class="own-song">
      <span v-if="ownSong" class="song-name">♪ {{ ownSong.name ?? 'Your song' }}</span>
      <span v-else>No song uploaded yet.</span>
      <button type="button" class="btn btn-secondary" :disabled="songBusy" @click="songInput?.click()">{{ songBusy ? 'Uploading…' : ownSong ? 'Replace' : 'Upload a song' }}</button>
      <button v-if="ownSong" type="button" class="btn btn-secondary" :disabled="songBusy" @click="removeOwnSong">Remove</button>
      <input ref="songInput" type="file" accept="audio/*" hidden @change="onSongFile" />
      <p v-if="songError" class="form-error" role="alert">{{ songError }}</p>
      <p v-else class="hint">Up to {{ SONG_MAX_MB }} MB: MP3, M4A, Ogg, WebM, FLAC or WAV. Only you can play it.</p>
    </div>
    <audio ref="audio" :src="songUrl ?? undefined" loop preload="none" />
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
          <p class="value" :class="{ long: slide.value.length > 18 }">
            <span aria-hidden="true">{{ shownValue }}</span><span class="visually-hidden">{{ slide.value }}</span>
          </p>
          <p v-if="slide.sub" class="sub">{{ slide.sub }}</p>
          <div v-if="slide.bars" class="bars" role="img" :aria-label="barsLabel">
            <span v-for="(n, i) in slide.bars" :key="i" class="col">
              <span class="fill" :style="{ height: `${(n / maxBar) * 100}%`, '--i': i }" />
              <span class="m">{{ MONTH_NAMES[i]!.charAt(0) }}</span>
            </span>
          </div>
          <ol v-if="slide.list?.length" class="list" :class="{ summary: slide.key === 'summary' }">
            <li v-for="(item, i) in slide.list" :key="item.name" :style="{ '--i': i }">
              <span class="name">{{ item.name }}</span><span class="detail">{{ item.detail }}</span>
            </li>
          </ol>
          <div v-if="slide.key === 'summary'" class="confetti" aria-hidden="true">
            <span
              v-for="(c, i) in confetti"
              :key="i"
              :class="`tone-${c.tone}`"
              :style="{ left: `${c.x}%`, animationDelay: `${c.delay}ms`, '--drift': `${c.drift}vw`, '--spin': `${c.spin}deg` }"
            />
          </div>
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
.tools,
.music {
  display: flex;
  align-items: center;
  gap: 6px;
}
.music select {
  min-height: var(--tap, 44px);
}
.own-song {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding-top: 8px;
  text-align: center;
}
.own-song p {
  flex-basis: 100%;
  margin: 0;
}
.song-name {
  overflow-wrap: anywhere;
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
  transform-origin: bottom;
  animation: grow 0.6s ease-out both;
  animation-delay: calc(var(--i, 0) * 40ms + 150ms);
}
@keyframes grow {
  from {
    transform: scaleY(0);
  }
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
.list li {
  animation: rise 0.35s ease-out both;
  animation-delay: calc(var(--i, 0) * 60ms + 200ms);
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}
.slide {
  position: relative;
}
.confetti {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.confetti span {
  position: absolute;
  top: -12px;
  width: 8px;
  height: 14px;
  border-radius: 2px;
  background: var(--brand);
  opacity: 0;
  animation: fall 2.4s ease-in forwards;
}
.confetti .tone-1 {
  background: var(--text-muted);
}
.confetti .tone-2 {
  background: var(--brand-tint);
  outline: 1px solid var(--brand);
}
@keyframes fall {
  0% {
    opacity: 1;
    transform: translate(0, 0) rotate(0);
  }
  100% {
    opacity: 0;
    transform: translate(var(--drift), 105vh) rotate(var(--spin));
  }
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
  .fill,
  .list li {
    animation: none;
  }
  .confetti {
    display: none;
  }
}
</style>
