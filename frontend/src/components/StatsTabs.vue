<script setup lang="ts">
// Tabs across the Insights screens (docs/backlog.md item 12). The filters ride
// along in the query, so switching tabs keeps them. A tab whose field the
// workspace hides (Settings → Fields) is left out.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useStats } from '../composables/useStats';
import SectionTabs from './SectionTabs.vue';

const TABS: Array<{ name: string; text: string; field?: string }> = [
  { name: 'stats-overview', text: 'Overview' },
  { name: 'stats-brews', text: 'Brews' },
  { name: 'stats-beans', text: 'Beans' },
  { name: 'stats-methods', text: 'Methods' },
  { name: 'stats-recipes', text: 'Recipes' },
  { name: 'stats-tools', text: 'Prep', field: 'brew.prepTools' },
  { name: 'stats-grinders', text: 'Grinders', field: 'brew.grinder' },
];

const route = useRoute();
const stats = useStats();
const tabs = computed(() =>
  TABS.filter((t) => !t.field || !stats.hidden.value.has(t.field)).map((t) => ({ to: { name: t.name, query: route.query }, text: t.text })),
);
</script>

<template>
  <SectionTabs label="Insights" :tabs="tabs" />
</template>
