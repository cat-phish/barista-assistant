<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, errorMessage } from '../api/client';
import AppHeader from '../components/AppHeader.vue';
import { ROLE_LABELS } from '../lib/roles';
import { SLUG_PATTERN, slugify } from '../lib/slug';
import { useWorkspaceStore } from '../stores/workspace';

const workspaces = useWorkspaceStore();
const router = useRouter();

const loading = ref(true);
const loadError = ref('');
const name = ref('');
const slug = ref('');
const slugEdited = ref(false);
const creating = ref(false);
const createError = ref('');

watch(name, (value) => {
  if (!slugEdited.value) slug.value = slugify(value);
});

const slugInvalid = computed(() => slug.value.length > 0 && !SLUG_PATTERN.test(slug.value));
const canCreate = computed(() => name.value.trim().length > 0 && SLUG_PATTERN.test(slug.value) && !creating.value);

onMounted(async () => {
  try {
    await workspaces.load();
  } catch (err) {
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
});

async function open(id: string): Promise<void> {
  workspaces.select(id);
  await router.push({ name: 'home' });
}

async function create(): Promise<void> {
  if (!canCreate.value) return;
  createError.value = '';
  creating.value = true;
  try {
    await workspaces.create(name.value.trim(), slug.value);
    await router.push({ name: 'home' });
  } catch (err) {
    createError.value =
      err instanceof ApiError && err.status === 409 ? 'That web address is taken. Try another.' : errorMessage(err);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <AppHeader />
  <main class="page">
    <section v-if="loading" class="muted" aria-live="polite">Loading your workspaces…</section>
    <p v-else-if="loadError" class="form-error" role="alert">{{ loadError }}</p>

    <section v-else-if="workspaces.workspaces.length > 0" class="stack">
      <h1>Your workspaces</h1>
      <ul class="list">
        <li v-for="w in workspaces.workspaces" :key="w.id">
          <button class="workspace" type="button" @click="open(w.id)">
            <span class="name">{{ w.name }}</span>
            <span class="role">{{ ROLE_LABELS[w.role] }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section v-else class="stack">
      <h1>Welcome!</h1>
      <p class="muted">
        A workspace holds your beans, recipes and brew journal, like a coffee bar you can share with others.
        Create your first one to get started.
      </p>
    </section>

    <section v-if="!loading && !loadError" class="card stack">
      <h2>Create a workspace</h2>
      <form class="stack" novalidate @submit.prevent="create">
        <div class="field">
          <label for="ws-name">Name<span class="req" aria-hidden="true">*</span></label>
          <input id="ws-name" aria-required="true" v-model="name" type="text" maxlength="255" placeholder="e.g. Jordan's Coffee Bar" required />
        </div>
        <div class="field">
          <label for="ws-slug">Web address<span class="req" aria-hidden="true">*</span></label>
          <input
            id="ws-slug" aria-required="true"
            v-model.trim="slug"
            type="text"
            inputmode="url"
            autocapitalize="none"
            spellcheck="false"
            maxlength="64"
            :aria-invalid="slugInvalid"
            aria-describedby="ws-slug-hint"
            @input="slugEdited = true"
          />
          <span id="ws-slug-hint" class="hint" :class="{ invalid: slugInvalid }">
            3–64 lowercase letters, digits or hyphens. Your public menu will be at /menu/{{ slug || '…' }}
          </span>
        </div>
        <p v-if="createError" class="form-error" role="alert">{{ createError }}</p>
        <button class="btn btn-primary" type="submit" :disabled="!canCreate">
          {{ creating ? 'Creating…' : 'Create workspace' }}
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 560px;
  margin: 0 auto;
  padding: var(--space-4) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
h1 {
  font-size: 1.5rem;
}
h2 {
  font-size: 1.15rem;
}
p {
  margin: 0;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.workspace {
  width: 100%;
  min-height: var(--tap);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--text);
}
.workspace:hover {
  border-color: var(--brand);
}
.name {
  font-weight: 600;
}
.role {
  font-size: 0.8rem;
  padding: 2px var(--space-2);
  border-radius: 999px;
  background: var(--brand-tint);
  color: var(--brand);
  flex-shrink: 0;
}
.hint.invalid {
  color: var(--danger);
}
</style>
