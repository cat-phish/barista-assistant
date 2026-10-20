<script setup lang="ts">
// Drinks (docs/api_spec.md §5c): what's served, and what the public menu lists.
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import { drinksApi } from '../api/drinks';
import type { Drink } from '../api/types';
import AppHeader from '../components/AppHeader.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import MenuTabs from '../components/MenuTabs.vue';
import { componentLine, recipesLine } from '../lib/drinks';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const drinks = ref<Drink[]>([]);
const loading = ref(true);
const error = ref('');

async function load(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws) return;
  try {
    drinks.value = (await drinksApi.list(ws)).drinks;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

// Sections by category, uncategorised ("Other drinks") last.
const sections = computed(() => {
  const groups = new Map<string | null, Drink[]>();
  for (const d of drinks.value) groups.set(d.category, [...(groups.get(d.category) ?? []), d]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([category, list]) => ({ title: category ?? (groups.size > 1 ? 'Other drinks' : null), list }));
});

// The methods a drink's recipes use, e.g. "V60" or "Espresso".
const methodsOf = (d: Drink) => [...new Set(d.recipes.map((r) => r.method.name))];

const pending = ref<Drink | null>(null);
const busy = ref(false);
const dialogError = ref('');
const pendingName = computed(() => pending.value?.name ?? '');
async function confirmDelete(): Promise<void> {
  const ws = workspaces.current?.id;
  if (!ws || !pending.value) return;
  busy.value = true;
  dialogError.value = '';
  try {
    await drinksApi.remove(ws, pending.value.id);
    pending.value = null;
    await load();
  } catch (err) {
    dialogError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <div class="page-header">
      <h1>Drinks</h1>
      <RouterLink v-if="workspaces.canEdit" class="btn btn-primary" :to="{ name: 'drink-new' }">Add drink</RouterLink>
    </div>
    <MenuTabs />
    <p class="muted intro">A drink is brewed with one of its recipes and finished with components. The public menu lists drinks.</p>

    <p v-if="loading" class="muted" aria-live="polite">Loading drinks…</p>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>

    <div v-else-if="drinks.length === 0" class="card empty">
      <p>No drinks yet.</p>
      <p v-if="workspaces.canEdit">A plain "V60" is a drink too: pick its recipe and leave out components.</p>
    </div>

    <section v-for="s in sections" v-else :key="s.title ?? ''" class="stack section">
      <h2 v-if="s.title" class="section-title">{{ s.title }}</h2>
      <ul class="list">
        <li v-for="d in s.list" :key="d.id" class="card drink">
          <div class="head">
            <h2>{{ d.name }}</h2>
            <span v-for="m in methodsOf(d)" :key="m" class="badge">{{ m }}</span>
            <span v-if="!d.showOnPublicMenu" class="badge muted-badge">Hidden from menu</span>
          </div>
          <p v-if="d.description" class="muted">{{ d.description }}</p>
          <p v-if="d.recipes.length" class="facts"><span class="label">Recipes</span> {{ recipesLine(d) }}</p>
          <p v-else class="form-error">No recipes left. Edit it to choose one.</p>
          <p class="facts">
            <span class="label">Finish with</span>
            {{ d.components.length ? d.components.map(componentLine).join(' · ') : 'Nothing: just the coffee' }}
          </p>
          <div v-if="workspaces.canEdit" class="actions">
            <RouterLink class="btn-link" :to="{ name: 'drink-edit', params: { id: d.id } }">Edit</RouterLink>
            <button class="btn-link danger" type="button" @click="pending = d; dialogError = ''">Delete</button>
          </div>
        </li>
      </ul>
    </section>
  </main>

  <ConfirmDialog :open="pending !== null" title="Delete this drink?" @cancel="pending = null">
    <p>{{ pendingName }} will be removed. Brews made for it are kept.</p>
    <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
    <template #actions>
      <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmDelete">Delete</button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="pending = null">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
h2 {
  font-size: 1.15rem;
  margin: 0;
}
p {
  margin: 0;
}
.intro {
  margin-top: calc(-1 * var(--space-2));
}
.section-title {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.drink {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
}
.head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-right: var(--space-1);
}
.actions {
  display: flex;
  justify-content: flex-end;
  margin: 0 calc(-1 * var(--space-2)) calc(-1 * var(--space-2));
}
</style>
