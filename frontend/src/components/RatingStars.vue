<script setup lang="ts">
defineProps<{ rating: number | null }>();
</script>

<template>
  <span v-if="rating !== null" class="stars" :aria-label="`Rated ${rating} of 5`" role="img">
    <span v-for="n in 5" :key="n" :class="{ on: n <= rating }" aria-hidden="true">★</span>
  </span>
  <span v-else class="muted unrated">Not rated</span>
</template>

<style scoped>
.stars {
  color: var(--border);
  letter-spacing: 1px;
  white-space: nowrap;
}
.on {
  color: #f9a825;
}
.unrated {
  font-size: 0.85rem;
}
</style>
