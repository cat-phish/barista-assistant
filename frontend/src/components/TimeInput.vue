<script setup lang="ts">
// A m:ss time field (brew time, target windows, step and roast times). Phone
// number pads have no colon key, so the colon goes in by itself: the digits
// fill in from the right (maskTime). id, placeholder, aria-* and listeners
// fall through to the input.
import { maskTime } from '../lib/format';

const model = defineModel<string>({ required: true });

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement;
  const masked = maskTime(el.value);
  // Set the input too: when the mask leaves the value as it was (a typed
  // colon), the model doesn't change and wouldn't redraw it.
  el.value = masked;
  model.value = masked;
}
</script>

<template>
  <input :value="model" inputmode="numeric" autocomplete="off" @input="onInput" />
</template>
