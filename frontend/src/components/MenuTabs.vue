<script setup lang="ts">
// Tabs across recipes, the drinks made from them, and the ingredients that
// finish drinks (docs/api/README.md §5, §5b, §5c).
import SectionTabs from './SectionTabs.vue';

const tabs = [
  { to: { name: 'recipes' }, text: 'Recipes' },
  { to: { name: 'drinks' }, text: 'Drinks' },
  { to: { name: 'ingredients' }, text: 'Ingredients' },
];
</script>

<template>
  <SectionTabs label="Recipes and drinks" :tabs="tabs" />
</template>
