<script setup lang="ts">
// Tabs across the Insights screens (docs/roadmap.md, "Insights"). The filters ride
// along in the query, so switching tabs keeps them; the charts' own periods
// (`p.<chart>`) don't. A tab whose field the workspace hides (Settings →
// Fields) is left out.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { usePreferences } from '../composables/usePreferences';
import { useStats } from '../composables/useStats';
import { CHART_PERIOD_PREFIX } from '../lib/statsRange';
import SectionTabs from './SectionTabs.vue';

const TABS: Array<{ name: string; text: string; field?: string; chat?: boolean }> = [
  { name: 'stats-overview', text: 'Overview' },
  { name: 'stats-brews', text: 'Brews' },
  { name: 'stats-beans', text: 'Beans' },
  { name: 'stats-methods', text: 'Methods' },
  { name: 'stats-recipes', text: 'Recipes' },
  { name: 'stats-tools', text: 'Prep', field: 'brew.prepTools' },
  { name: 'stats-grinders', text: 'Grinders', field: 'brew.grinder' },
  { name: 'stats-explore', text: 'Explore' },
  { name: 'stats-recap', text: 'Recap' },
  { name: 'stats-chat', text: 'Chat', chat: true },
];

const route = useRoute();
const stats = useStats();
const { settings } = usePreferences();
const query = computed(() => Object.fromEntries(Object.entries(route.query).filter(([k]) => !k.startsWith(CHART_PERIOD_PREFIX))));
const tabs = computed(() =>
  TABS.filter((t) => (!t.field || !stats.hidden.value.has(t.field)) && (!t.chat || settings.value.aiChat)).map((t) => ({ to: { name: t.name, query: query.value }, text: t.text })),
);
</script>

<template>
  <SectionTabs label="Insights" :tabs="tabs" />
</template>
