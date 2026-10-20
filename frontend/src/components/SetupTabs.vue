<script setup lang="ts">
// Tabs across the Bar setup screens: brewers, grinders, and the categories
// that organise brewing and the menu.
import SectionTabs from './SectionTabs.vue';

const tabs = [
  { to: { name: 'brewers' }, text: 'Brewers' },
  { to: { name: 'grinders' }, text: 'Grinders' },
  { to: { name: 'categories' }, text: 'Categories' },
];
</script>

<template>
  <SectionTabs label="Bar setup" :tabs="tabs" />
</template>
