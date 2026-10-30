<script setup lang="ts">
// A rating (docs/api/brew-logs.md §6) as a radio group; tap the chosen value
// again to clear. In half steps (the workspace's ratingStep) each star's left
// half picks the .5 below it.
import { computed } from 'vue';
import { usePreferences } from '../composables/usePreferences';
import { ratingLabel, starFills, starValues } from '../lib/rating';

const model = defineModel<number | null>({ required: true });
// name: the radio group, unique per form (a drink brew has two ratings).
withDefaults(defineProps<{ name?: string; label?: string }>(), { name: 'rating', label: 'Rating' });
const { ratingStep } = usePreferences();
const fills = computed(() => starFills(model.value ?? 0));
function pick(value: number): void {
  model.value = model.value === value ? null : value;
}
</script>

<template>
  <fieldset class="rating">
    <legend>{{ label }}</legend>
    <div class="options">
      <span v-for="n in 5" :key="n" class="star" :class="fills[n - 1]">
        <span aria-hidden="true">★</span>
        <label
          v-for="v in starValues(n, ratingStep)"
          :key="v"
          :class="Number.isInteger(v) ? (ratingStep === 'half' ? 'right' : 'whole') : 'left'"
          :title="ratingLabel(v)"
        >
          <input type="radio" :name="name" :value="v" :checked="model === v" @click="pick(v)" />
          <span class="visually-hidden">{{ ratingLabel(v) }}</span>
        </label>
      </span>
    </div>
  </fieldset>
</template>

<style scoped>
.rating {
  border: none;
  margin: 0;
  padding: 0;
}
legend {
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0;
  margin-bottom: var(--space-1);
}
.options {
  display: flex;
  gap: var(--space-1);
}
.star {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: var(--tap);
  font-size: 1.8rem;
  color: var(--border);
}
.star.full {
  color: #f9a825;
}
/* A half star: the gold glyph over the grey one, cut at the middle. */
.star.half > span[aria-hidden] {
  position: relative;
}
.star.half > span[aria-hidden]::before {
  content: '★';
  position: absolute;
  left: 0;
  width: 50%;
  overflow: hidden;
  color: #f9a825;
}
label {
  position: absolute;
  top: 0;
  bottom: 0;
  cursor: pointer;
}
label.whole {
  left: 0;
  right: 0;
}
label.left {
  left: 0;
  right: 50%;
}
label.right {
  left: 50%;
  right: 0;
}
input {
  position: absolute;
  opacity: 0;
  inset: 0;
  margin: 0;
  cursor: pointer;
}
.star:has(input:focus-visible) {
  outline: 3px solid var(--focus);
  border-radius: var(--radius);
}
</style>
