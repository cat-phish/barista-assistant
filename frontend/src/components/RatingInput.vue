<script setup lang="ts">
// 1–5 rating (docs/api/brew-logs.md §6) as a radio group; tap the chosen value again to clear.
const model = defineModel<number | null>({ required: true });
// name: the radio group, unique per form (a drink brew has two ratings).
withDefaults(defineProps<{ name?: string; label?: string }>(), { name: 'rating', label: 'Rating' });
const LABELS = ['', 'Bad', 'Meh', 'OK', 'Good', 'Great'];
</script>

<template>
  <fieldset class="rating">
    <legend>{{ label }}</legend>
    <div class="options">
      <label v-for="n in 5" :key="n" :class="{ chosen: model !== null && n <= model }" :title="LABELS[n]">
        <input type="radio" :name="name" :value="n" :checked="model === n" @click="model = model === n ? null : n" />
        <span aria-hidden="true">★</span>
        <span class="visually-hidden">{{ n }} – {{ LABELS[n] }}</span>
      </label>
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
label {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: var(--tap);
  font-size: 1.8rem;
  color: var(--border);
  cursor: pointer;
}
label.chosen {
  color: #f9a825;
}
input {
  position: absolute;
  opacity: 0;
  inset: 0;
  margin: 0;
  cursor: pointer;
}
label:has(input:focus-visible) {
  outline: 3px solid var(--focus);
  border-radius: var(--radius);
}
</style>
