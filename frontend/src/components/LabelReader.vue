<script setup lang="ts">
// "Fill in from a photo" at the top of the bean form (docs/api/bean-label.md
// §4d): photos of the label, taken or picked just for this, are read and
// then thrown away; they're never added to the bean's photos.
import { ref } from 'vue';
import { beansApi } from '../api/beans';
import { ApiError, errorMessage } from '../api/client';
import type { LabelFields } from '../api/types';
import { photoBase64 } from '../lib/photoResize';

const MAX_PHOTOS = 6; // MAX_BEAN_PHOTOS in @barista/shared/schema

const props = defineProps<{ workspaceId: string }>();
const emit = defineEmits<{ label: [fields: LabelFields] }>();

const reading = ref(false);
const error = ref('');
const camera = ref<HTMLInputElement | null>(null);
const chooser = ref<HTMLInputElement | null>(null);

async function picked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = ''; // the same photo can be picked again
  if (files.length === 0) return;
  reading.value = true;
  error.value = files.length > MAX_PHOTOS ? `Read the first ${MAX_PHOTOS} photos.` : '';
  try {
    const images = await Promise.all(files.slice(0, MAX_PHOTOS).map(photoBase64));
    emit('label', (await beansApi.readLabel(props.workspaceId, images)).fields);
  } catch (err) {
    // Not the API's: a photo the browser couldn't load or decode.
    error.value = err instanceof ApiError ? errorMessage(err) : 'A photo couldn’t be prepared. Try again, or with another photo.';
  } finally {
    reading.value = false;
  }
}
</script>

<template>
  <section class="card stack" aria-labelledby="label-reader">
    <h2 id="label-reader">Fill in from a photo</h2>
    <p class="muted small">
      Photograph the bag's label (front and back if you like) and the AI fills in what it can read. The photos are only read, not kept; you
      check the fields before saving.
    </p>
    <!-- capture opens the camera on a phone; the other picks from the library or files. -->
    <input ref="camera" class="visually-hidden" type="file" accept="image/*" capture="environment" tabindex="-1" @change="picked" />
    <input ref="chooser" class="visually-hidden" type="file" accept="image/*" multiple tabindex="-1" @change="picked" />
    <div class="pick">
      <button type="button" class="btn btn-secondary" :disabled="reading" @click="camera?.click()">Take photo</button>
      <button type="button" class="btn btn-secondary" :disabled="reading" @click="chooser?.click()">Choose photos</button>
    </div>
    <p v-if="reading" class="muted small" aria-live="polite">Reading the label… this can take half a minute.</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <slot />
  </section>
</template>

<style scoped>
h2 {
  font-size: 1.05rem;
}
p {
  margin: 0;
}
.pick {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
