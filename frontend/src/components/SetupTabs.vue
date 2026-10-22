<script setup lang="ts">
// Tabs across the Bar setup screens: brewers, grinders, the categories that
// organise brewing, and the public menu (arranged by hand, §7b).
import SectionTabs from './SectionTabs.vue';

const tabs = [
  { to: { name: 'brewers' }, text: 'Brewers' },
  { to: { name: 'grinders' }, text: 'Grinders' },
  { to: { name: 'categories' }, text: 'Categories' },
  { to: { name: 'menu-builder' }, text: 'Menu' },
];
</script>

<template>
  <SectionTabs label="Bar setup" :tabs="tabs" />
</template>
