<script setup lang="ts">
// Tabs across the Bar setup screens: brewers, grinders, water, vessels, prep tools and
// the public menu (arranged by hand, §7b). Drink categories live on Drinks.
import SectionTabs from './SectionTabs.vue';

const tabs = [
  { to: { name: 'brewers' }, text: 'Brewers' },
  { to: { name: 'grinders' }, text: 'Grinders' },
  { to: { name: 'water-profiles' }, text: 'Water' },
  { to: { name: 'vessels' }, text: 'Vessels' },
  { to: { name: 'prep-tools' }, text: 'Prep' },
  { to: { name: 'menu-builder' }, text: 'Menu' },
];
</script>

<template>
  <SectionTabs label="Bar setup" :tabs="tabs" />
</template>
