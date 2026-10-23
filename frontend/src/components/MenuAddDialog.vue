<script setup lang="ts">
// The menu builder's add picker (docs/api/menu.md §7b): drinks by category
// (with "Select all"), plain brews by method and the beans block, side by
// side; what's on the menu already is marked. Adds the ticked ones in one go.
import { computed, ref, watch } from 'vue';
import type { NewMenuItem } from '../api/menu';
import type { Brewer, Drink, DrinkCategory, Menu, MenuSection } from '../api/types';
import { addOptions, addRequest, type AddGroup, type AddOption } from '../lib/menuBuilder';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{
  section: MenuSection | null; // open while set
  menu: Menu;
  drinks: Drink[];
  categories: DrinkCategory[];
  brewers: Brewer[];
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ cancel: []; add: [items: NewMenuItem[]] }>();

const picked = ref(new Set<string>());
const beans = ref(false);
watch(
  () => props.section,
  () => {
    picked.value = new Set();
    beans.value = false;
  },
);

const options = computed(() =>
  props.section ? addOptions(props.menu, props.section.id, props.drinks, props.categories, props.brewers) : null,
);
const request = computed(() => (options.value ? addRequest(options.value, picked.value, beans.value) : []));

function toggle(o: AddOption, on: boolean): void {
  const next = new Set(picked.value);
  if (on) next.add(o.id);
  else next.delete(o.id);
  picked.value = next;
}
// A category's "Select all": every option not already in the section.
const addable = (g: AddGroup) => g.options.filter((o) => !o.here);
const allPicked = (g: AddGroup) => addable(g).length > 0 && addable(g).every((o) => picked.value.has(o.id));
function toggleAll(g: AddGroup, on: boolean): void {
  const next = new Set(picked.value);
  for (const o of addable(g)) {
    if (on) next.add(o.id);
    else next.delete(o.id);
  }
  picked.value = next;
}
const note = (o: AddOption) => (o.here ? 'in this section' : o.elsewhere.length ? `also in ${o.elsewhere.join(', ')}` : '');
</script>

<template>
  <ConfirmDialog :open="section !== null" :title="`Add to ${section?.name ?? ''}`" @cancel="emit('cancel')">
    <div v-if="options" class="picker">
      <fieldset v-for="g in options.drinks" :key="g.key" class="group">
        <legend>
          {{ g.name }}
          <label v-if="addable(g).length > 1" class="checkbox all">
            <input type="checkbox" :checked="allPicked(g)" @change="toggleAll(g, ($event.target as HTMLInputElement).checked)" />
            Select all
          </label>
        </legend>
        <label v-for="o in g.options" :key="o.id" class="checkbox option" :style="{ paddingLeft: `calc(${o.depth} * var(--space-3))` }">
          <input type="checkbox" :checked="o.here || picked.has(o.id)" :disabled="o.here" @change="toggle(o, ($event.target as HTMLInputElement).checked)" />
          <span>{{ o.name }}<span v-if="note(o)" class="muted small"> · {{ note(o) }}</span></span>
        </label>
      </fieldset>

      <fieldset v-if="options.brewers.length" class="group">
        <legend>Plain brews</legend>
        <template v-for="g in options.brewers" :key="g.key">
          <label v-for="o in g.options" :key="o.id" class="checkbox option">
            <input type="checkbox" :checked="o.here || picked.has(o.id)" :disabled="o.here" @change="toggle(o, ($event.target as HTMLInputElement).checked)" />
            <span>{{ o.name }} <span class="muted small">({{ g.name }})</span><span v-if="note(o)" class="muted small"> · {{ note(o) }}</span></span>
          </label>
        </template>
      </fieldset>

      <fieldset class="group">
        <legend>Your beans</legend>
        <label class="checkbox option">
          <input v-model="beans" type="checkbox" :disabled="options.beans.here || !!options.beans.elsewhere" />
          <span>
            Beans block
            <span class="muted small">
              · {{ options.beans.here ? 'in this section' : options.beans.elsewhere ? `already in ${options.beans.elsewhere} (the menu has one)` : 'your active beans that are shown on the menu' }}
            </span>
          </span>
        </label>
      </fieldset>
      <p v-if="!options.drinks.length && !options.brewers.length" class="muted small">No active drinks or brewers yet.</p>
    </div>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <template #actions>
      <button class="btn btn-primary" type="button" :disabled="busy || request.length === 0" @click="emit('add', request)">
        {{ request.length ? `Add ${request.length}` : 'Add' }}
      </button>
      <button class="btn btn-secondary" type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-height: min(60vh, 32rem);
  overflow-y: auto;
  margin-bottom: var(--space-3);
}
.group {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
legend {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-weight: 600;
  padding: 0;
  margin-bottom: var(--space-1);
}
.all {
  font-weight: 400;
  font-size: 0.85rem;
}
.option {
  align-items: flex-start;
}
.small {
  font-size: 0.85rem;
}
</style>
