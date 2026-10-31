<script setup lang="ts">
// How a bean's brews rated, under its rating (docs/api/beans.md §4
// brew-summary). Nothing until a brew is rated.
import { computed } from 'vue';
import type { BeanBrewSummary } from '../api/beans';
import { brewAverageText } from '../lib/rating';

const props = defineProps<{ summary: BeanBrewSummary | null }>();
const text = computed(() => brewAverageText(props.summary));
</script>

<template>
  <p v-if="text" class="brew-average muted">{{ text }}</p>
</template>

<style scoped>
.brew-average {
  margin: 0;
  font-size: 0.85rem;
}
</style>
