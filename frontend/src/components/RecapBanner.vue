<script setup lang="ts">
// The brew page's recap banner (docs/api/recaps.md §11c, "Banner"): a
// weekly, monthly or yearly recap just ended and had your brews, or Your
// Year in Coffee is out (7 December to the year's end). Gone once opened
// (Insights → Recap marks it seen), dismissed, or recapBannerDays after the
// period ends. One /stats?mine=1 request, only when a period is due, and
// remembered for this page load.
import { computed, ref, watch } from 'vue';
import { statsApi } from '../api/stats';
import { usePreferences } from '../composables/usePreferences';
import { localDateInput } from '../lib/format';
import { bannerFor, markSeen, recapsDue, type RecapDue } from '../lib/recap';
import { periodLabel } from '../lib/recapPeriods';
import { localDay } from '../lib/stats';
import { startYearSong } from '../lib/yearSong';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

// Brew days per workspace and date range, kept until the app reloads.
const brewDaysCache = new Map<string, Promise<string[]>>();

const auth = useAuthStore();
const workspaces = useWorkspaceStore();
const { prefs } = usePreferences();
const today = localDateInput();
const due = computed(() => recapsDue(prefs.value, today));
const days = ref<string[] | null>(null);
const hidden = ref(false);

watch(
  [() => workspaces.current?.id, () => due.value.map((d) => d.period.start).join()],
  async ([ws]) => {
    days.value = null;
    const list = due.value;
    if (!ws || !list.length) return;
    const from = list.map((d) => d.period.start).sort()[0]!;
    const to = list.map((d) => d.period.end).sort().at(-1)!;
    const key = `${ws}|${from}|${to}`;
    let request = brewDaysCache.get(key);
    if (!request) {
      request = statsApi.get(ws, { from, to, mine: true }).then((d) => [...new Set(d.brews.map(localDay))]);
      brewDaysCache.set(key, request);
      request.catch(() => brewDaysCache.delete(key));
    }
    try {
      days.value = await request;
    } catch {
      days.value = null; // no banner rather than an error on the brew page
    }
  },
  { immediate: true },
);

const banner = computed(() => {
  const d = days.value;
  if (!d || hidden.value) return null;
  return bannerFor(prefs.value, today, (x) => d.some((day) => day >= x.period.start && day <= x.period.end));
});
const SHORT = { weekly: 'The week', monthly: 'The month', yearly: 'The year' } as const;
const linkText = (d: RecapDue, several: boolean) => (!several ? 'See it' : d.kind === 'yearInCoffee' ? `Your ${d.period.start.slice(0, 4)}` : SHORT[d.kind]);
const linkTo = (d: RecapDue) =>
  d.kind === 'yearInCoffee' ? { name: 'stats-year', query: { year: d.period.start.slice(0, 4) } } : { name: 'stats-recap', query: { kind: d.kind, start: d.period.start } };
const linkTitle = (d: RecapDue) => (d.kind === 'yearInCoffee' ? `Your Year in Coffee: 1 January – 6 December ${d.period.start.slice(0, 4)}` : periodLabel(d.kind, d.period));

async function dismiss(): Promise<void> {
  const b = banner.value;
  if (!b) return;
  hidden.value = true;
  try {
    await auth.setPreferences({ recapSeen: markSeen(prefs.value.recapSeen, b.due) });
  } catch {
    // Hidden for now; it shows again next time if this didn't save.
  }
}
</script>

<template>
  <aside v-if="banner" class="recap-banner" aria-label="Recap">
    <p>
      {{ banner.text }}
      <template v-for="(d, i) in banner.due" :key="d.kind">
        <template v-if="i"> · </template>
        <RouterLink :to="linkTo(d)" :title="linkTitle(d)" @click="d.kind === 'yearInCoffee' && startYearSong(auth.user)">{{ linkText(d, banner.due.length > 1) }}</RouterLink>
      </template>
    </p>
    <button type="button" class="close" aria-label="Dismiss the recap banner" @click="dismiss">×</button>
  </aside>
</template>

<style scoped>
.recap-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  border-radius: var(--radius);
  background: var(--brand-tint);
  font-size: 0.9rem;
}
.recap-banner p {
  margin: 0;
  flex: 1;
}
.close {
  flex: none;
  min-width: var(--tap);
  min-height: var(--tap);
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
}
.close:hover {
  color: var(--text);
}
</style>
