<script setup lang="ts">
// "Finish the drink" after a brew: the ingredients (scaled to the size made)
// and the drink's instructions, line breaks kept (docs/api/drinks.md §5c).
import type { Drink } from '../api/types';
import { ingredientLine } from '../lib/drinks';

defineProps<{ drink: Drink; factor: number; sizeLabel?: string | null }>();
</script>

<template>
  <section v-if="drink.ingredients.length || drink.instructions" class="card stack finish" aria-labelledby="finish-title">
    <h2 id="finish-title">Finish the {{ drink.name }}<template v-if="sizeLabel"> · {{ sizeLabel }}</template></h2>
    <ul v-if="drink.ingredients.length">
      <li v-for="c in drink.ingredients" :key="c.ingredientId">{{ ingredientLine(c, factor) }}</li>
    </ul>
    <p v-if="drink.instructions" class="instructions">{{ drink.instructions }}</p>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1.1rem;
  margin: 0;
}
ul {
  margin: 0;
  padding-left: var(--space-4);
}
.instructions {
  margin: 0;
  white-space: pre-line;
}
</style>
