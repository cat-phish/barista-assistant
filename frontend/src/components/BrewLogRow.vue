<script setup lang="ts">
// One earlier brew, briefer than the journal: what was made and when, the
// bean and recipe, then dose, grind and rating. In "Pick a brew…"
// (RepeatBrewPicker) and the chat's attach picker (ChatAttachDialog).
import type { BrewLog } from '../api/types';
import { formatDoseLine, formatGrind } from '../lib/format';
import { repeatLabel } from '../lib/repeatBrew';
import RatingStars from './RatingStars.vue';

defineProps<{ log: BrewLog }>();
</script>

<template>
  <span class="brew-row">
    <span class="top">
      <strong>{{ repeatLabel(log).made }}</strong>
      <span class="muted small">{{ repeatLabel(log).when }}</span>
    </span>
    <span class="muted small">{{ log.bean.roasterName }} {{ repeatLabel(log).bean }}<template v-if="log.recipe"> · {{ log.recipe.name }}</template></span>
    <span class="facts small">
      <span>{{ formatDoseLine(log.actualDoseGrams, log.actualWaterGrams, log.actualYieldGrams, log.actualIceGrams) }}</span>
      <span v-if="log.actualGrindSetting !== null">grind {{ formatGrind(log.actualGrindSetting) }}</span>
      <RatingStars :rating="log.rating ?? log.drinkRating" />
    </span>
  </span>
</template>

<style scoped>
.brew-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.top {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  align-items: center;
}
</style>
