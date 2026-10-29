<script setup lang="ts">
// Roast mode → Roasts (docs/api/roasts.md §4f): every roast, newest first.
// A roast opens its page.
import { onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import { roastsApi } from '../api/roasts';
import type { Roast } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import { formatListDay, localDateInput } from '../lib/format';
import { readyOn, roastDay, roastLevelLabel, weightLoss } from '../lib/roasting';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const roasts = ref<Roast[]>([]);
const loading = ref(true);
const error = ref('');
const today = localDateInput();

onMounted(async () => {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    roasts.value = (await roastsApi.list(ws)).roasts;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

const ready = (r: Roast) => {
  const day = readyOn(r);
  return day <= today ? 'Ready' : `Ready ${formatListDay(day)}`;
};
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Roasts</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'roast-new' }">Log a roast</RouterLink>
    </div>

    <p v-if="loading" class="muted" aria-live="polite">Loading roasts…</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-else-if="!loading && roasts.length === 0" class="card empty"><p>No roasts yet. Each one you log adds its coffee to Beans.</p></div>
    <ul v-else class="list">
      <li v-for="r in roasts" :key="r.id">
        <RouterLink class="card item" :to="{ name: 'roast', params: { id: r.id } }">
          <span class="head">
            <strong>{{ r.greenCoffee?.name ?? 'Deleted green coffee' }}<template v-if="r.batchNumber"> · batch {{ r.batchNumber }}</template></strong>
            <span class="badge" :class="{ resting: readyOn(r) > today }">{{ ready(r) }}</span>
          </span>
          <span class="muted small">
            {{ formatListDay(roastDay(r)) }} · {{ r.greenGrams }} g → {{ r.roastedGrams }} g ({{ weightLoss(r.greenGrams, r.roastedGrams) }}% loss)<template v-if="roastLevelLabel(r)"> · {{ roastLevelLabel(r) }}</template><template v-if="r.machine"> · {{ r.machine.name }}</template>
          </span>
        </RouterLink>
      </li>
    </ul>
  </main>
</template>

<style scoped>
p {
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--text);
  text-decoration: none;
}
.item:hover {
  border-color: var(--brand-edge);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
}
.badge.resting {
  background: var(--warning-tint);
  color: var(--warning);
}
</style>
