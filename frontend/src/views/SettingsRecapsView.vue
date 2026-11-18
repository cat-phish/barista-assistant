<script setup lang="ts">
// Settings → Recaps (docs/api/recaps.md §11c, "Settings"): recaps always
// exist; per kind (weekly, monthly, yearly, Your Year in Coffee) a banner,
// a push and an automatic AI summary switch. Saved as soon as one changes;
// the browser's time zone goes with every save, so the notification comes
// at your local time.
import { computed, ref } from 'vue';
import { errorMessage } from '../api/client';
import type { RecapSwitches, RecapSwitchKind, UserPreferences } from '../api/types';
import SettingsLayout from '../components/SettingsLayout.vue';
import { useAiAvailable } from '../composables/useAiAvailable';
import { usePreferences } from '../composables/usePreferences';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const { prefs } = usePreferences();
const aiAvailable = useAiAvailable();
const saving = ref(false);
const error = ref('');
const saved = ref(false);

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

async function set(changes: Partial<UserPreferences>): Promise<void> {
  saving.value = true;
  error.value = '';
  saved.value = false;
  try {
    const timeZone = browserTimeZone();
    await auth.setPreferences(timeZone && timeZone !== prefs.value.timeZone ? { ...changes, timeZone } : changes);
    saved.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
const checked = (e: Event) => (e.target as HTMLInputElement).checked;

const kinds: ReadonlyArray<{ kind: RecapSwitchKind; label: string; when: string }> = [
  { kind: 'weekly', label: 'Weekly', when: 'The day a new week starts' },
  { kind: 'monthly', label: 'Monthly', when: 'The 1st of the month' },
  { kind: 'yearly', label: 'Yearly', when: '1 January' },
  { kind: 'yearInCoffee', label: 'Your Year in Coffee', when: '7 December, for 1 January to 6 December' },
];
type SwitchKey = 'recapBanners' | 'recapPushes' | 'recapAutoSummaries';
const columns = computed<ReadonlyArray<{ key: SwitchKey; label: string }>>(() => [
  { key: 'recapBanners', label: 'Banner' },
  { key: 'recapPushes', label: 'Push' },
  ...(aiAvailable.value ? [{ key: 'recapAutoSummaries' as const, label: 'AI summary' }] : []),
]);
function toggle(key: SwitchKey, kind: RecapSwitchKind, on: boolean): Promise<void> {
  const next: RecapSwitches = { ...prefs.value[key], [kind]: on };
  return set({ [key]: next });
}
const anyBanner = computed(() => Object.values(prefs.value.recapBanners).some(Boolean));
const anyPush = computed(() => Object.values(prefs.value.recapPushes).some(Boolean));
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekEnds = computed(() => weekdays[(prefs.value.weekStartsOn + 6) % 7]);
// Every 15 minutes, as the server checks.
const times = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
const timeLabel = (t: string) => new Date(`2000-01-01T${t}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const zone = computed(() => prefs.value.timeZone ?? browserTimeZone());

// Your Year in Coffee's music (recaps.md §11c "Motion and sound") and your
// own song (auth.md §1 "Year song"): 10 MB, checked again by the server.
const uploadsOn = computed(() => auth.user?.features.yearSongUploads ?? false);
const ownSong = computed(() => auth.user?.song ?? null);
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
    await auth.uploadSong(file);
  } catch (err) {
    songError.value = errorMessage(err);
  } finally {
    songBusy.value = false;
  }
}
async function removeOwnSong(): Promise<void> {
  songError.value = '';
  songBusy.value = true;
  try {
    await auth.removeSong();
  } catch (err) {
    songError.value = errorMessage(err);
  } finally {
    songBusy.value = false;
  }
}
</script>

<template>
  <SettingsLayout title="Recaps">
    <p class="muted">How your week or month in coffee went: brews, ratings, the best cup, beans opened and finished. Find them under Insights → Recap.</p>

    <section class="card stack" aria-labelledby="recap-kinds">
      <h2 id="recap-kinds">What tells you</h2>
      <table class="switches">
        <thead>
          <tr>
            <th scope="col"><span class="visually-hidden">Recap</span></th>
            <th v-for="c in columns" :key="c.key" scope="col">{{ c.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in kinds" :key="k.kind">
            <th scope="row">
              {{ k.label }}
              <span class="muted small">{{ k.when }}</span>
            </th>
            <td v-for="c in columns" :key="c.key">
              <input type="checkbox" :aria-label="`${k.label}: ${c.label}`" :checked="prefs[c.key][k.kind]" :disabled="saving" @change="toggle(c.key, k.kind, checked($event))" />
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted small">
        Only for a period you brewed in. Push goes to your channels under <RouterLink :to="{ name: 'settings-notifications' }">Notifications</RouterLink>.
        <template v-if="aiAvailable"> AI summary: written for your own brews when the period ends, leaving out the details hidden under Settings → AI. Off, the recap has a Write summary button instead.</template>
      </p>
      <div class="field">
        <label for="recap-week-start" class="label">Weeks start on</label>
        <select id="recap-week-start" :value="prefs.weekStartsOn" :disabled="saving" @change="set({ weekStartsOn: Number(($event.target as HTMLSelectElement).value) })">
          <option v-for="(d, i) in weekdays" :key="d" :value="i">{{ d }}</option>
        </select>
        <p class="muted small">{{ weekdays[prefs.weekStartsOn] }} to {{ weekEnds }}. Insights' weekly charts follow it too.</p>
      </div>
      <div class="field" :class="{ dim: !anyBanner }">
        <label for="recap-banner-days" class="label">Hide the banner after</label>
        <select id="recap-banner-days" :value="prefs.recapBannerDays" :disabled="saving || !anyBanner" @change="set({ recapBannerDays: Number(($event.target as HTMLSelectElement).value) })">
          <option v-for="n in 14" :key="n" :value="n">{{ n }} {{ n === 1 ? 'day' : 'days' }}</option>
        </select>
        <p class="muted small">It also goes once you open the recap or dismiss it.</p>
      </div>
      <div class="field" :class="{ dim: !anyPush }">
        <label for="recap-notify-time" class="label">Push at</label>
        <select id="recap-notify-time" :value="prefs.recapNotifyTime" :disabled="saving || !anyPush" @change="set({ recapNotifyTime: ($event.target as HTMLSelectElement).value })">
          <option v-for="t in times" :key="t" :value="t">{{ timeLabel(t) }}</option>
        </select>
        <p v-if="zone" class="muted small">{{ zone }} time.</p>
      </div>
    </section>

    <section class="card stack" aria-labelledby="recap-year">
      <h2 id="recap-year">Your Year in Coffee</h2>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.yearMusic" :disabled="saving" @change="set({ yearMusic: checked($event) })" />
        Play music
      </label>
      <p class="muted small">It starts on your first tap. The mute button on the slides mutes it for that viewing.</p>
      <div v-if="uploadsOn" class="field">
        <span class="label">Your song</span>
        <div class="song-row">
          <span v-if="ownSong" class="song-name">♪ {{ ownSong.name ?? 'Your song' }}</span>
          <span v-else class="muted">None: the built-in song plays.</span>
          <button type="button" class="btn btn-secondary" :disabled="songBusy" @click="songInput?.click()">{{ songBusy ? 'Saving…' : ownSong ? 'Replace' : 'Upload a song' }}</button>
          <button v-if="ownSong" type="button" class="btn btn-secondary" :disabled="songBusy" @click="removeOwnSong">Remove</button>
          <input ref="songInput" type="file" accept="audio/*" hidden @change="onSongFile" />
        </div>
        <p v-if="songError" class="form-error" role="alert">{{ songError }}</p>
        <p v-else class="muted small">Plays instead of the built-in song. Up to {{ SONG_MAX_MB }} MB: MP3, M4A, Ogg, WebM, FLAC or WAV. Only you can play it.</p>
      </div>
    </section>

    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p class="visually-hidden" aria-live="polite">{{ saved ? 'Saved.' : '' }}</p>
  </SettingsLayout>
</template>

<style scoped>
.song-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.song-name {
  overflow-wrap: anywhere;
}
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.field select {
  align-self: flex-start;
}
.label {
  font-weight: 600;
}
.dim {
  opacity: 0.6;
}
.switches {
  border-collapse: collapse;
  width: 100%;
}
.switches th,
.switches td {
  padding: var(--space-2) var(--space-1);
  border-bottom: 1px solid var(--border);
}
.switches thead th {
  font-size: 0.85rem;
  text-align: center;
}
.switches tbody th {
  text-align: left;
  font-weight: 600;
}
.switches tbody th .small {
  display: block;
  font-weight: 400;
}
.switches td {
  text-align: center;
}
.switches input {
  width: 22px;
  height: 22px;
}
</style>
