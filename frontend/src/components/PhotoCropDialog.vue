<script setup lang="ts">
// Crop and rotate a photo before it's used (docs/api/bean-photos.md §4c):
// full screen, on Cropper.js, which is loaded the first time it opens. Done
// hands back the cropped image as a JPEG, full size: the server (or the
// label read) shrinks it. Parent controls `open`, like ConfirmDialog.
import type Cropper from 'cropperjs';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  source: Blob | null; // the photo to crop
  saved?: boolean; // a saved photo: Done replaces it
}>();
const emit = defineEmits<{ (e: 'done', image: Blob): void; (e: 'cancel'): void }>();

const dialog = ref<HTMLDialogElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const src = ref('');
const ready = ref(false);
const square = ref(false);
const working = ref(false);
const error = ref('');
let cropper: Cropper | null = null;
let run = 0; // a newer open wins over a slower one still loading

async function start(blob: Blob): Promise<void> {
  ready.value = false;
  square.value = false;
  error.value = '';
  const mine = ++run;
  src.value = URL.createObjectURL(blob);
  try {
    const [{ default: CropperJs }] = await Promise.all([import('cropperjs'), import('cropperjs/dist/cropper.css'), nextTick()]);
    const img = image.value;
    if (!img || mine !== run) return;
    if (!img.complete) await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('This photo couldn’t be opened'));
    });
    if (mine !== run) return;
    cropper = new CropperJs(img, {
      viewMode: 1, // the box stays on the photo
      autoCropArea: 1, // starts on the whole photo
      checkOrientation: true, // a JPEG's EXIF turn
      background: false,
      responsive: true,
      ready: () => (ready.value = true),
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'The crop editor couldn’t load';
  }
}

function stop(): void {
  run += 1;
  cropper?.destroy();
  cropper = null;
  ready.value = false;
  if (src.value) URL.revokeObjectURL(src.value);
  src.value = '';
}

watch(
  () => [props.open, props.source] as const,
  ([open, source]) => {
    if (open && !dialog.value?.open) dialog.value?.showModal();
    if (!open && dialog.value?.open) dialog.value.close();
    stop();
    if (open && source) void start(source);
  },
  { flush: 'post' },
);
onBeforeUnmount(stop);

function rotate(degrees: number): void {
  cropper?.rotate(degrees);
}
function toggleSquare(): void {
  square.value = !square.value;
  cropper?.setAspectRatio(square.value ? 1 : NaN);
}
function reset(): void {
  square.value = false;
  cropper?.reset();
  cropper?.setAspectRatio(NaN);
}

async function done(): Promise<void> {
  if (!cropper) return;
  working.value = true;
  error.value = '';
  try {
    const canvas = cropper.getCroppedCanvas({ maxWidth: 4096, maxHeight: 4096, imageSmoothingQuality: 'high' });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('The cropped photo couldn’t be made');
    emit('done', blob);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'The cropped photo couldn’t be made';
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <dialog ref="dialog" class="crop-dialog" aria-label="Crop photo" @cancel.prevent="emit('cancel')">
    <header>
      <h2>Crop photo</h2>
      <p class="muted small">Drag the box or its corners; pinch or scroll to zoom.</p>
    </header>
    <div class="area">
      <img v-if="src" ref="image" :src="src" alt="The photo being cropped" />
    </div>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <div class="tools" role="toolbar" aria-label="Crop tools">
      <button type="button" class="btn btn-secondary" :disabled="!ready" aria-label="Rotate left" @click="rotate(-90)">⟲ Left</button>
      <button type="button" class="btn btn-secondary" :disabled="!ready" aria-label="Rotate right" @click="rotate(90)">⟳ Right</button>
      <button type="button" class="btn btn-secondary" :class="{ on: square }" :disabled="!ready" :aria-pressed="square" @click="toggleSquare">Square</button>
      <button type="button" class="btn btn-secondary" :disabled="!ready" @click="reset">Reset</button>
    </div>
    <div class="actions">
      <p v-if="saved" class="muted small">Replaces the saved photo.</p>
      <button type="button" class="btn btn-secondary" @click="emit('cancel')">Cancel</button>
      <button type="button" class="btn btn-primary" :disabled="!ready || working" @click="done">{{ working ? 'Cropping…' : 'Done' }}</button>
    </div>
  </dialog>
</template>

<style scoped>
.crop-dialog {
  width: 100vw;
  max-width: 100vw;
  height: 100dvh;
  max-height: 100dvh;
  margin: 0;
  border: none;
  padding: var(--space-3);
  background: var(--surface);
  color: var(--text);
}
.crop-dialog[open] {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.crop-dialog::backdrop {
  background: rgb(0 0 0 / 0.6);
}
header h2 {
  font-size: 1.2rem;
  margin: 0;
}
header p {
  margin: 0;
}
/* The photo takes what's left above the buttons. */
.area {
  flex: 1;
  min-height: 0;
  background: var(--bg);
  border-radius: var(--radius);
  overflow: hidden;
  touch-action: none;
}
.area img {
  display: block;
  max-width: 100%; /* Cropper.js needs it */
}
.tools,
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.actions {
  justify-content: flex-end;
}
.actions p {
  margin: 0 auto 0 0;
}
.tools .btn.on {
  background: var(--brand-tint);
  border-color: var(--brand);
  color: var(--brand);
}
.field-error {
  margin: 0;
}
@media (max-width: 480px) {
  .tools .btn {
    flex: 1 1 calc(50% - var(--space-2));
  }
}
</style>
