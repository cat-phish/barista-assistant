<script setup lang="ts">
// Active and archived beans (docs/api/beans.md §4).
import SectionTabs from './SectionTabs.vue';

const tabs = [
  { to: { name: 'beans' }, text: 'Active' },
  { to: { name: 'beans-archived' }, text: 'Archived' },
];
</script>

<template>
  <SectionTabs label="Active and archived beans" :tabs="tabs" />
</template>
