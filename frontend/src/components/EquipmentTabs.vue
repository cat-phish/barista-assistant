<script setup lang="ts">
// Tabs across the Equipment screens (brewers, grinders).
import SectionTabs from './SectionTabs.vue';

const tabs = [
  { to: { name: 'brewers' }, text: 'Brewers' },
  { to: { name: 'grinders' }, text: 'Grinders' },
];
</script>

<template>
  <SectionTabs label="Equipment" :tabs="tabs" />
</template>
