<script setup lang="ts">
// Tabs across the Stats screens (docs/backlog.md item 12). The filters ride
// along in the query, so switching tabs keeps them.
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import SectionTabs from './SectionTabs.vue';

const route = useRoute();
const tabs = computed(() =>
  [
    { name: 'stats-overview', text: 'Overview' },
    { name: 'stats-brews', text: 'Brews' },
  ].map((t) => ({ to: { name: t.name, query: route.query }, text: t.text })),
);
</script>

<template>
  <SectionTabs label="Insights" :tabs="tabs" />
</template>
