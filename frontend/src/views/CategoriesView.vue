<script setup lang="ts">
// Drink categories (docs/api/drink-categories.md §5d), one tab of Bar setup: the first
// choice when brewing. The public menu has its own sections (Menu tab, §7b).
import { onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import { drinkCategoriesApi } from '../api/drinkCategories';
import type { DrinkCategory } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import DrinkCategoriesPanel from '../components/DrinkCategoriesPanel.vue';
import SetupTabs from '../components/SetupTabs.vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const categories = ref<DrinkCategory[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    categories.value = (await drinkCategoriesApi.list(ws)).categories;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Bar setup</h1>
    </div>
    <SetupTabs />
    <p class="muted intro">Put brewers and drinks in categories on their own pages; here you name the categories and set their order.</p>
    <p v-if="loading" class="muted" aria-live="polite">Loading categories…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <DrinkCategoriesPanel v-else :categories="categories" @changed="load" />
  </main>
</template>

<style scoped>
.intro {
  margin: calc(-1 * var(--space-2)) 0 0;
}
</style>
