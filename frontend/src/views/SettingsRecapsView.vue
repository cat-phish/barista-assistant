<script setup lang="ts">
// Settings → Recaps (docs/api/recaps.md §11c, "Settings"): your weekly and monthly
// recaps, the banner on the brew page, the notification and the AI
// summary. Saved as soon as one changes; the browser's time zone goes with
// every save, so the notification comes at your local time. With recaps
// off, Insights → Recap still shows one when you ask.
import { computed, ref } from 'vue';
import { errorMessage } from '../api/client';
import type { RecapAiMode, RecapPeriodChoice, UserPreferences } from '../api/types';
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

const periods: ReadonlyArray<{ value: RecapPeriodChoice; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'both', label: 'Both' },
];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekEnds = computed(() => weekdays[(prefs.value.weekStartsOn + 6) % 7]);
const aiModes: ReadonlyArray<{ value: RecapAiMode; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'Recaps are figures only, and no AI is used.' },
  { value: 'manual', label: 'When I ask', hint: 'A Write summary button in the recap. Only then is the AI used.' },
  { value: 'auto', label: 'Automatically', hint: 'Written for your own brews when a week or month ends, so it is ready with the notification. Uses the AI every period.' },
];
const aiHint = computed(() => aiModes.find((m) => m.value === prefs.value.recapAi)?.hint ?? '');
// Every 15 minutes, as the server checks.
const times = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
const timeLabel = (t: string) => new Date(`2000-01-01T${t}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const zone = computed(() => prefs.value.timeZone ?? browserTimeZone());
</script>

<template>
  <SettingsLayout title="Recaps">
    <p class="muted">How your week or month in coffee went: brews, ratings, the best cup, beans opened and finished. Find them under Insights → Recap.</p>

    <section class="card stack" aria-labelledby="recap-on">
      <h2 id="recap-on">Recaps</h2>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.recaps" :disabled="saving" @change="set({ recaps: checked($event) })" />
        Tell me when a recap is ready
      </label>
      <p class="muted small">Off: no banner, notifications or automatic summaries. Insights → Recap still shows one when you ask.</p>
      <div class="field">
        <span id="recap-periods" class="label">Recaps for</span>
        <div class="segmented" role="radiogroup" aria-labelledby="recap-periods">
          <label v-for="c in periods" :key="c.value" :class="{ on: prefs.recapPeriods === c.value }">
            <input type="radio" name="recap-periods" :value="c.value" :checked="prefs.recapPeriods === c.value" :disabled="saving" @change="set({ recapPeriods: c.value })" />
            {{ c.label }}
          </label>
        </div>
      </div>
      <div class="field">
        <label for="recap-week-start" class="label">Weeks start on</label>
        <select id="recap-week-start" :value="prefs.weekStartsOn" :disabled="saving" @change="set({ weekStartsOn: Number(($event.target as HTMLSelectElement).value) })">
          <option v-for="(d, i) in weekdays" :key="d" :value="i">{{ d }}</option>
        </select>
        <p class="muted small">{{ weekdays[prefs.weekStartsOn] }} to {{ weekEnds }}. Insights' weekly charts follow it too.</p>
      </div>
    </section>

    <section class="card stack" aria-labelledby="recap-banner" :class="{ dim: !prefs.recaps }">
      <h2 id="recap-banner">Banner on the brew page</h2>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.recapBanner" :disabled="saving || !prefs.recaps" @change="set({ recapBanner: checked($event) })" />
        Show a banner when a recap is ready
      </label>
      <div class="field">
        <label for="recap-banner-days" class="label">Hide it after</label>
        <select id="recap-banner-days" :value="prefs.recapBannerDays" :disabled="saving || !prefs.recaps || !prefs.recapBanner" @change="set({ recapBannerDays: Number(($event.target as HTMLSelectElement).value) })">
          <option v-for="n in 14" :key="n" :value="n">{{ n }} {{ n === 1 ? 'day' : 'days' }}</option>
        </select>
        <p class="muted small">It also goes once you open the recap or dismiss it.</p>
      </div>
    </section>

    <section class="card stack" aria-labelledby="recap-notify" :class="{ dim: !prefs.recaps }">
      <h2 id="recap-notify">Notification</h2>
      <label class="checkbox">
        <input type="checkbox" :checked="prefs.recapNotify" :disabled="saving || !prefs.recaps" @change="set({ recapNotify: checked($event) })" />
        Send me a notification
      </label>
      <div class="field">
        <label for="recap-notify-time" class="label">At</label>
        <select id="recap-notify-time" :value="prefs.recapNotifyTime" :disabled="saving || !prefs.recaps || !prefs.recapNotify" @change="set({ recapNotifyTime: ($event.target as HTMLSelectElement).value })">
          <option v-for="t in times" :key="t" :value="t">{{ timeLabel(t) }}</option>
        </select>
        <p class="muted small">
          On the first day of a new week or month<template v-if="zone">, {{ zone }} time</template>. Only for a period you brewed in. It goes to your channels under
          <RouterLink :to="{ name: 'settings-notifications' }">Notifications</RouterLink>.
        </p>
      </div>
    </section>

    <section v-if="aiAvailable" class="card stack" aria-labelledby="recap-ai">
      <h2 id="recap-ai">AI summary</h2>
      <div class="segmented" role="radiogroup" aria-labelledby="recap-ai">
        <label v-for="c in aiModes" :key="c.value" :class="{ on: prefs.recapAi === c.value }">
          <input type="radio" name="recap-ai" :value="c.value" :checked="prefs.recapAi === c.value" :disabled="saving" @change="set({ recapAi: c.value })" />
          {{ c.label }}
        </label>
      </div>
      <p class="muted small">{{ aiHint }} It leaves out the details hidden under Settings → AI.<template v-if="!prefs.recaps && prefs.recapAi === 'auto'"> With recaps off, nothing is written automatically.</template></p>
    </section>

    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p class="visually-hidden" aria-live="polite">{{ saved ? 'Saved.' : '' }}</p>
  </SettingsLayout>
</template>

<style scoped>
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
.dim > :not(h2) {
  opacity: 0.6;
}
.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  align-self: flex-start;
  padding: 3px;
  gap: 3px;
  border-radius: var(--radius);
  background: var(--brand-tint);
}
.segmented label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: calc(var(--tap) - 6px);
  min-width: 4.5rem;
  padding: 0 var(--space-3);
  border-radius: calc(var(--radius) - 2px);
  color: var(--brand);
  font-weight: 600;
  cursor: pointer;
}
.segmented label.on {
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
.segmented input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.segmented label:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
