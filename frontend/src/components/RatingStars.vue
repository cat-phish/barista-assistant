<script setup lang="ts">
import { starFills } from '../lib/rating';

defineProps<{ rating: number | null }>();
</script>

<template>
  <span v-if="rating !== null" class="stars" :aria-label="`Rated ${rating} of 5`" role="img">
    <span v-for="(fill, i) in starFills(rating)" :key="i" :class="fill" aria-hidden="true">★</span>
  </span>
  <span v-else class="muted unrated">Not rated</span>
</template>

<style scoped>
.stars {
  color: var(--border);
  letter-spacing: 1px;
  white-space: nowrap;
}
.full {
  color: #f9a825;
}
/* A half star: the gold glyph over the grey one, cut at the middle. */
.half {
  position: relative;
  display: inline-block;
}
.half::before {
  content: '★';
  position: absolute;
  left: 0;
  width: 50%;
  overflow: hidden;
  color: #f9a825;
}
.unrated {
  font-size: 0.85rem;
}
</style>
