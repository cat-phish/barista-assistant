<script setup lang="ts">
// The Delete card at the bottom of an edit page (brewers, grinders, water,
// recipes, drinks, ingredients): opens DeleteDialog, then goes back to the list.
import { ref } from 'vue';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import type { DeletableKind, Usage } from '../lib/deleting';
import DeleteDialog from './DeleteDialog.vue';

const props = defineProps<{
  kind: DeletableKind;
  name: string;
  load: () => Promise<Usage>;
  remove: () => Promise<unknown>;
  back: RouteLocationRaw; // where to go once deleted
  archived?: boolean;
}>();
const router = useRouter();
const KIND_NAMES: Partial<Record<DeletableKind, string>> = { water: 'water profile', tool: 'prep item', green: 'green coffee' };
const open = ref(false);

async function deleted(): Promise<void> {
  open.value = false;
  await router.push(props.back);
}
</script>

<template>
  <section class="card danger-zone">
    <div>
      <h2>Delete this {{ KIND_NAMES[kind] ?? kind }}</h2>
      <p class="muted small">It's gone for good. You'll see what uses it before anything is deleted.</p>
    </div>
    <button class="btn btn-danger" type="button" @click="open = true">Delete</button>
  </section>
  <DeleteDialog :open="open" :kind="kind" :name="name" :load="load" :remove="remove" :archived="archived" @cancel="open = false" @deleted="deleted" />
</template>

<style scoped>
.danger-zone {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}
h2 {
  font-size: 1rem;
  margin: 0;
}
p {
  margin: 0;
}
.small {
  font-size: 0.85rem;
}
</style>
