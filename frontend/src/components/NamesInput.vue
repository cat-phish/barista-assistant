<script setup lang="ts">
// A list of names, as chips with a NameInput to add more (a bean's
// varieties): Enter, a comma or picking a suggestion adds what's typed, as
// does leaving the box; × removes one. Each name once, ignoring case, and
// names already in the list aren't suggested.
import { computed, ref } from 'vue';
import NameInput from './NameInput.vue';

const props = withDefaults(defineProps<{ id: string; names: readonly string[]; max?: number; maxlength?: number; placeholder?: string }>(), {
  max: 20,
  maxlength: 100,
  placeholder: undefined,
});
const model = defineModel<string[]>({ required: true });

const draft = ref('');
const has = (name: string) => model.value.some((n) => n.toLowerCase() === name.toLowerCase());
const offered = computed(() => props.names.filter((n) => !has(n)));
const full = computed(() => model.value.length >= props.max);

function add(text: string): void {
  const names = text.split(',').map((s) => s.trim().replace(/\s+/g, ' ').slice(0, props.maxlength)).filter(Boolean);
  const next = [...model.value];
  for (const name of names) if (next.length < props.max && !next.some((n) => n.toLowerCase() === name.toLowerCase())) next.push(name);
  if (next.length !== model.value.length) model.value = next;
  draft.value = '';
}
function remove(i: number): void {
  model.value = model.value.filter((_, j) => j !== i);
}
// A comma typed (or pasted) adds what's before it.
function onDraft(text: string): void {
  const cut = text.lastIndexOf(',');
  if (cut < 0) draft.value = text;
  else {
    add(text.slice(0, cut));
    draft.value = text.slice(cut + 1).trimStart();
  }
}
// NameInput handles Enter on a highlighted suggestion (and prevents it);
// otherwise Enter adds what's typed instead of submitting the form.
function onKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  if (e.key === 'Enter' && draft.value.trim()) {
    e.preventDefault();
    add(draft.value);
  } else if (e.key === 'Backspace' && !draft.value && model.value.length) {
    remove(model.value.length - 1);
  }
}
</script>

<template>
  <div class="names-input">
    <ul v-if="model.length" class="chips">
      <li v-for="(name, i) in model" :key="name" class="badge">
        {{ name }}
        <button type="button" class="remove" :aria-label="`Remove ${name}`" @click="remove(i)">×</button>
      </li>
    </ul>
    <NameInput
      v-if="!full"
      :id="id"
      :model-value="draft"
      :names="offered"
      :hint="false"
      :maxlength="maxlength"
      :placeholder="placeholder"
      @update:model-value="onDraft"
      @pick="add"
      @keydown="onKeydown"
      @blur="add(draft)"
    />
  </div>
</template>

<style scoped>
.names-input {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.chips .badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 0.875rem;
  padding-right: 0;
}
.remove {
  min-width: 2rem;
  min-height: 2rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}
</style>
