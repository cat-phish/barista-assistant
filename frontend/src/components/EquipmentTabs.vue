<script setup lang="ts">
// Tabs across the Equipment screens (grinders, machines, brew methods).
import SectionTabs from './SectionTabs.vue';

const tabs = [
  { to: { name: 'grinders' }, text: 'Grinders' },
  { to: { name: 'machines' }, text: 'Machines' },
  { to: { name: 'brew-methods' }, text: 'Methods' },
];
</script>

<template>
  <SectionTabs label="Equipment" :tabs="tabs" />
</template>
