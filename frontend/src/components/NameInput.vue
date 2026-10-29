<script setup lang="ts">
// A text input that suggests names already used in the workspace (roasters,
// coffees, producers, suppliers on the bean form; lib/nameSuggest.ts): a list
// under it while typing, and "You have: …" when what's there is one of them
// spelled differently (while typing too, unless the list already offers it).
// The input's own attributes (maxlength, placeholder, aria-*) pass through.
import { computed, ref } from 'vue';
import LabelHint from './LabelHint.vue';
import { closeMatch, rankNames } from '../lib/nameSuggest';

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ id: string; names: readonly string[]; prefer?: readonly string[]; hint?: boolean }>(), {
  prefer: () => [],
  hint: true,
});
const model = defineModel<string>({ required: true });

const focused = ref(false);
const dismissed = ref(false); // Escape: closed until the next keystroke
const active = ref(-1);
const listId = computed(() => `${props.id}-names`);

const options = computed(() => rankNames(model.value, props.names, { prefer: props.prefer }));
const open = computed(() => focused.value && !dismissed.value && options.value.length > 0);
const close = computed(() => {
  const match = props.hint ? closeMatch(model.value, props.names) : null;
  return match && !(open.value && options.value.includes(match)) ? match : null;
});

function onInput(e: Event): void {
  model.value = (e.target as HTMLInputElement).value;
  dismissed.value = false;
  active.value = -1;
}
function pick(name: string): void {
  model.value = name;
  dismissed.value = true;
  active.value = -1;
}
function onKeydown(e: KeyboardEvent): void {
  if (!open.value) {
    if (e.key === 'ArrowDown' && options.value.length) {
      dismissed.value = false;
      e.preventDefault();
    }
    return;
  }
  const n = options.value.length;
  if (e.key === 'ArrowDown') active.value = (active.value + 1) % n;
  else if (e.key === 'ArrowUp') active.value = active.value <= 0 ? n - 1 : active.value - 1;
  else if (e.key === 'Escape') dismissed.value = true;
  else if (e.key === 'Enter' && active.value >= 0) pick(options.value[active.value]);
  else return;
  e.preventDefault();
}
function onBlur(): void {
  focused.value = false;
  active.value = -1;
}
</script>

<template>
  <div class="name-input">
    <input
      v-bind="$attrs"
      :id="id"
      :value="model"
      autocomplete="off"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open && active >= 0 ? `${listId}-${active}` : undefined"
      @input="onInput"
      @keydown="onKeydown"
      @focus="focused = true"
      @blur="onBlur"
    />
    <!-- mousedown.prevent keeps focus in the input, so the tap's click lands -->
    <ul v-show="open" :id="listId" role="listbox" class="names" @mousedown.prevent>
      <li
        v-for="(name, i) in options"
        :id="`${listId}-${i}`"
        :key="name"
        role="option"
        :aria-selected="i === active"
        :class="{ active: i === active }"
        @click="pick(name)"
      >
        {{ name }}
      </li>
    </ul>
  </div>
  <LabelHint v-if="close" prefix="You have:" :text="close" @use="pick(close)" />
</template>

<style scoped>
.name-input {
  position: relative;
}
.name-input input {
  width: 100%;
}
.names {
  position: absolute;
  z-index: 20;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  margin: 0;
  padding: var(--space-1) 0;
  list-style: none;
  max-height: 16rem;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
}
.names li {
  display: flex;
  align-items: center;
  min-height: var(--tap);
  padding: 0 var(--space-3);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.names li:hover,
.names li.active {
  background: var(--brand-tint);
}
</style>
