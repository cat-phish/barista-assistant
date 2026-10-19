<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <main class="auth-page">
    <div class="brand">
      <img src="/favicon.svg" alt="" width="56" height="56" />
      <span>Coffee Brew Journal</span>
    </div>
    <section class="card auth-card">
      <h1>{{ title }}</h1>
      <slot />
    </section>
    <p class="footer"><slot name="footer" /></p>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-3);
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--brand);
}
.auth-card {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
h1 {
  font-size: 1.5rem;
}
.footer {
  margin: 0;
  color: var(--text-muted);
}
</style>
