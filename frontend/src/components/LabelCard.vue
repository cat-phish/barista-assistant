<script setup lang="ts">
// "Fill in with AI", under the Photos card (docs/api/bean-label.md §4d):
// photos taken or picked here are only for the read (shown, not kept), and
// the bean's photos can go with them. Nothing is read until the button.
// With the workspace's labelWebLookup, it can also look the bean up on the
// web afterwards: ticked per read, as it takes longer. "Look it up on the
// web" runs the lookup alone, from what the form says (again after a read,
// or without photos). The read runs in stores/labelRead.ts, so it carries on
// if you leave; the form takes the answer. Its photos can be cropped first
// (PhotoCropDialog), so the label fills more of the picture.
import { computed, onBeforeUnmount, ref } from 'vue';
import type { LabelLookUp } from '../api/types';
import { LABEL_MAX_IMAGES, canLookUp, labelImages } from '../lib/labelFill';
import { croppedFile, replaceFile } from '../lib/photoCrop';
import PhotoCropDialog from './PhotoCropDialog.vue';
import { useLabelReadStore, type LabelReadKey } from '../stores/labelRead';

const props = defineProps<{
  workspaceId: string;
  beanPhotos: ReadonlyArray<() => Promise<Blob>>; // cover first; [] when photos are hidden
  webLookup: boolean; // the workspace allows "Also look it up on the web"
  website: string; // the form's, to keep the search to the roaster's site
  known: LabelLookUp; // what the form says, for "Look it up on the web"
  readKey: LabelReadKey; // which form the answer is for
  name: string; // the bean, for the notice while you're elsewhere
  initialExtras?: File[]; // picked before you left Add bean (stores/beanDraft.ts)
}>();

interface Extra {
  key: number;
  file: File;
  url: string;
}
let nextKey = 0;
const extras = ref<Extra[]>((props.initialExtras ?? []).map((file) => ({ key: nextKey++, file, url: URL.createObjectURL(file) })));
const includeBean = ref(true);
const lookUp = ref(false); // unticked each time: slower, and costs more
const note = ref('');
const camera = ref<HTMLInputElement | null>(null);
const chooser = ref<HTMLInputElement | null>(null);

const reads = useLabelReadStore();
const mine = computed(() => (reads.current?.key === props.readKey ? reads.current : null));
const reading = computed(() => mine.value?.status === 'reading');
const searching = computed(() => !!mine.value?.web); // this read includes a web lookup
const step = computed(() => mine.value?.step);
const canSearch = computed(() => canLookUp(props.known));
const error = computed(() => (mine.value?.status === 'failed' ? mine.value.error : ''));

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

const cropping = ref<Extra | null>(null);
function cropped(image: Blob): void {
  const target = cropping.value;
  cropping.value = null;
  if (!target) return;
  const { list, revoke } = replaceFile(extras.value, target.key, croppedFile(image, target.file.name));
  extras.value = list;
  if (revoke) URL.revokeObjectURL(revoke);
}

async function readLabel(): Promise<void> {
  const { images, left } = sending.value;
  note.value = left ? `Read the first ${images.length} photos; ${left} left out.` : '';
  const web = props.webLookup && lookUp.value;
  await reads.start(props.readKey, props.name, props.workspaceId, images, web ? { web, website: props.website.trim() || null } : {});
}
async function lookUpOnly(): Promise<void> {
  note.value = '';
  await reads.lookUp(props.readKey, props.name, props.workspaceId, props.known);
}
defineExpose({ extraFiles: () => extras.value.map((e) => e.file) });

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
    <PhotoCropDialog :open="!!cropping" :source="cropping?.file ?? null" @done="cropped" @cancel="cropping = null" />
    <ul v-if="extras.length" class="extras">
      <li v-for="(e, i) in extras" :key="e.key">
        <img :src="e.url" :alt="`Label photo ${i + 1}`" />
        <button type="button" class="extra-remove" :disabled="reading" :aria-label="`Remove label photo ${i + 1}`" @click="remove(e.key)">✕</button>
        <button type="button" class="extra-crop" :disabled="reading" :aria-label="`Crop label photo ${i + 1}`" title="Crop or rotate" @click="cropping = e">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2v14a2 2 0 0 0 2 2h14" />
            <path d="M18 22V8a2 2 0 0 0-2-2H2" />
          </svg>
        </button>
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
    <label v-if="webLookup" class="checkbox with-note">
      <input v-model="lookUp" type="checkbox" :disabled="reading" />
      <span>
        Also look it up on the web
        <span class="muted small hint">Takes longer, provides suggestions with sources.</span>
      </span>
    </label>
    <div class="row">
      <button type="button" class="btn btn-primary" :disabled="reading || count === 0" @click="readLabel">
        {{ reading && mine?.photos ? 'Reading the label…' : count ? `✦ Fill in from ${count} photo${count === 1 ? '' : 's'}` : '✦ Fill in from photos' }}
      </button>
      <span v-if="!count && !reading" class="muted small">Add a photo of the label first.</span>
    </div>
    <div v-if="webLookup" class="row">
      <button type="button" class="btn btn-secondary" :disabled="reading || !canSearch" @click="lookUpOnly">
        {{ reading && step === 'web' ? 'Looking it up…' : 'Look it up on the web' }}
      </button>
      <span v-if="!reading" class="muted small">{{ canSearch ? "From what's filled in below, no photos." : 'Needs the roaster or the coffee first.' }}</span>
    </div>
    <p class="small" role="status">
      {{
        !reading
          ? ''
          : step === 'web'
            ? 'Looking it up on the web: this can take a couple of minutes. You can leave this page meanwhile.'
            : searching
              ? 'Reading the label, then looking it up on the web: this can take a couple of minutes. You can leave this page meanwhile.'
              : 'Still reading the label: this can take half a minute. You can leave this page meanwhile.'
      }}
    </p>
    <p v-if="note" class="muted small">{{ note }}</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <slot />
  </div>
</template>

<style scoped>
p {
  margin: 0;
}
/* The box beside the label's first line, not centred on label and note. */
.with-note {
  align-items: flex-start;
}
.with-note input {
  margin-top: 0.1rem;
}
.hint {
  display: block;
  font-weight: 400;
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
.extra-remove,
.extra-crop {
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
.extra-crop {
  top: auto;
  bottom: -0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
</style>
