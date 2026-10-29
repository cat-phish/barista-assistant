<script setup lang="ts">
// "Fill in with AI", under the Photos card (docs/api/bean-label.md §4d):
// photos taken or picked here are only for the read (shown, not kept), and
// the bean's photos can go with them. Nothing is read until the button.
import { computed, onBeforeUnmount, ref } from 'vue';
import type { LabelFields } from '../api/types';
import { useLabelRead } from '../composables/useLabelRead';
import { LABEL_MAX_IMAGES, labelImages } from '../lib/labelFill';

const props = defineProps<{
  workspaceId: string;
  beanPhotos: ReadonlyArray<() => Promise<Blob>>; // cover first; [] when photos are hidden
}>();
const emit = defineEmits<{ label: [fields: LabelFields] }>();

interface Extra {
  key: number;
  file: File;
  url: string;
}
const extras = ref<Extra[]>([]);
let nextKey = 0;
const includeBean = ref(true);
const note = ref('');
const camera = ref<HTMLInputElement | null>(null);
const chooser = ref<HTMLInputElement | null>(null);

const { reading, error, read } = useLabelRead(() => props.workspaceId, (fields) => emit('label', fields));

const sending = computed(() => labelImages<File | (() => Promise<Blob>)>(extras.value.map((e) => e.file), includeBean.value ? props.beanPhotos : []));
const count = computed(() => sending.value.images.length);

function picked(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = ''; // the same photo can be picked again
  const room = LABEL_MAX_IMAGES - extras.value.length;
  note.value = files.length > room ? `At most ${LABEL_MAX_IMAGES} photos; ${files.length - room} left out.` : '';
  extras.value = [...extras.value, ...files.slice(0, Math.max(0, room)).map((file) => ({ key: nextKey++, file, url: URL.createObjectURL(file) }))];
}
function remove(key: number): void {
  const e = extras.value.find((x) => x.key === key);
  if (e) URL.revokeObjectURL(e.url);
  extras.value = extras.value.filter((x) => x.key !== key);
}

async function readLabel(): Promise<void> {
  const { images, left } = sending.value;
  note.value = left ? `Read the first ${images.length} photos; ${left} left out.` : '';
  await read(images);
}

onBeforeUnmount(() => extras.value.forEach((e) => URL.revokeObjectURL(e.url)));
</script>

<template>
  <div class="label-card stack">
    <p class="muted small">
      The AI reads the bag's label and fills in what it can; you check it before saving. Photos added here are only read, not kept.
    </p>
    <!-- capture opens the camera on a phone; the other picks from the library or files. -->
    <input ref="camera" class="visually-hidden" type="file" accept="image/*" capture="environment" tabindex="-1" @change="picked" />
    <input ref="chooser" class="visually-hidden" type="file" accept="image/*" multiple tabindex="-1" @change="picked" />
    <ul v-if="extras.length" class="extras">
      <li v-for="(e, i) in extras" :key="e.key">
        <img :src="e.url" :alt="`Label photo ${i + 1}`" />
        <button type="button" class="extra-remove" :disabled="reading" :aria-label="`Remove label photo ${i + 1}`" @click="remove(e.key)">✕</button>
      </li>
    </ul>
    <div class="row">
      <button type="button" class="btn btn-secondary" :disabled="reading" @click="camera?.click()">Take photo</button>
      <button type="button" class="btn btn-secondary" :disabled="reading" @click="chooser?.click()">Choose photos</button>
    </div>
    <label v-if="beanPhotos.length" class="checkbox">
      <input v-model="includeBean" type="checkbox" :disabled="reading" />
      Also read the bean's photos ({{ beanPhotos.length }})
    </label>
    <div class="row">
      <button type="button" class="btn btn-primary" :disabled="reading || count === 0" @click="readLabel">
        {{ reading ? 'Reading the label…' : count ? `✦ Fill in from ${count} photo${count === 1 ? '' : 's'}` : '✦ Fill in from photos' }}
      </button>
      <span v-if="!count && !reading" class="muted small">Add a photo of the label first.</span>
    </div>
    <p class="small" role="status">{{ reading ? 'Still reading the label: this can take half a minute. Keep this page open.' : '' }}</p>
    <p v-if="note" class="muted small">{{ note }}</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <slot />
  </div>
</template>

<style scoped>
p {
  margin: 0;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.extras {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.extras li {
  position: relative;
}
.extras img {
  display: block;
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.extra-remove {
  position: absolute;
  top: -0.5rem;
  right: -0.5rem;
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
</style>
