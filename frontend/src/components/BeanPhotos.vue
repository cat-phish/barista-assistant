<script setup lang="ts">
// A bean's photos on its form (docs/api/bean-photos.md §4c): the first is
// the cover. Editing a saved bean changes them straight away; a new bean
// holds the picked files until it's saved (uploadPending, called by the
// form once it has the bean's id).
import { computed, onBeforeUnmount, ref } from 'vue';
import { beansApi } from '../api/beans';
import { errorMessage } from '../api/client';
import type { BeanPhoto } from '../api/types';

const MAX_PHOTOS = 6; // MAX_BEAN_PHOTOS in @barista/shared/schema

const props = defineProps<{ workspaceId: string; beanId: string | null }>();
const photos = defineModel<BeanPhoto[]>({ required: true });

// Picked before the bean exists: shown from the file itself.
interface Pending {
  key: number;
  file: File;
  url: string;
}
const pending = ref<Pending[]>([]);
let nextKey = 0;
const busy = ref(false);
const error = ref('');
const camera = ref<HTMLInputElement | null>(null);
const chooser = ref<HTMLInputElement | null>(null);

interface Tile {
  key: string;
  src: string;
  label: string;
  remove: () => void;
  cover: () => void;
}
const tiles = computed<Tile[]>(() =>
  props.beanId
    ? photos.value.map((p, i) => ({
        key: p.id,
        src: beansApi.photoUrl(props.workspaceId, props.beanId!, p.id),
        label: `Photo ${i + 1}`,
        remove: () => void removeSaved(p.id),
        cover: () => void coverSaved(p.id),
      }))
    : pending.value.map((p, i) => ({
        key: `new-${p.key}`,
        src: p.url,
        label: `Photo ${i + 1}`,
        remove: () => removePending(p.key),
        cover: () => coverPending(p.key),
      })),
);
const room = computed(() => MAX_PHOTOS - tiles.value.length);

async function picked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = ''; // the same photo can be picked again
  if (files.length === 0) return;
  error.value = files.length > room.value ? `A bean has at most ${MAX_PHOTOS} photos; ${files.length - room.value} left out.` : '';
  const take = files.slice(0, Math.max(0, room.value));
  if (!props.beanId) {
    pending.value.push(...take.map((file) => ({ key: nextKey++, file, url: URL.createObjectURL(file) })));
    return;
  }
  busy.value = true;
  try {
    for (const file of take) photos.value = [...photos.value, (await beansApi.addPhoto(props.workspaceId, props.beanId, file)).photo];
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function removeSaved(id: string): Promise<void> {
  if (!props.beanId) return;
  busy.value = true;
  error.value = '';
  try {
    await beansApi.removePhoto(props.workspaceId, props.beanId, id);
    photos.value = photos.value.filter((p) => p.id !== id);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}
async function coverSaved(id: string): Promise<void> {
  if (!props.beanId) return;
  busy.value = true;
  error.value = '';
  try {
    photos.value = (await beansApi.makeCover(props.workspaceId, props.beanId, id)).photos;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

function removePending(key: number): void {
  const p = pending.value.find((x) => x.key === key);
  if (p) URL.revokeObjectURL(p.url);
  pending.value = pending.value.filter((x) => x.key !== key);
}
function coverPending(key: number): void {
  const p = pending.value.find((x) => x.key === key);
  if (p) pending.value = [p, ...pending.value.filter((x) => x.key !== key)];
}

// After the bean is created: uploads what was picked, in order. Returns an
// error message if any didn't make it ('' if all did).
async function uploadPending(beanId: string): Promise<string> {
  const failed: string[] = [];
  for (const p of pending.value) {
    try {
      await beansApi.addPhoto(props.workspaceId, beanId, p.file);
    } catch (err) {
      failed.push(errorMessage(err));
    }
  }
  return failed.length ? `${failed.length} photo${failed.length === 1 ? '' : 's'} couldn’t be added: ${failed[0]}` : '';
}
defineExpose({ uploadPending });

onBeforeUnmount(() => pending.value.forEach((p) => URL.revokeObjectURL(p.url)));
</script>

<template>
  <div class="bean-photos stack">
    <ul v-if="tiles.length" class="tiles" :aria-busy="busy">
      <li v-for="(t, i) in tiles" :key="t.key" class="tile">
        <img :src="t.src" :alt="t.label" loading="lazy" />
        <span v-if="i === 0" class="badge cover-badge">Cover</span>
        <div class="tile-actions">
          <button v-if="i > 0" type="button" class="btn-link small" :disabled="busy" @click="t.cover()">Make cover</button>
          <button type="button" class="btn-link small danger" :disabled="busy" :aria-label="`Remove ${t.label.toLowerCase()}`" @click="t.remove()">Remove</button>
        </div>
      </li>
    </ul>
    <p v-else class="muted small">A photo of the bag or label, to spot it at a glance.</p>
    <div v-if="room > 0" class="pick">
      <!-- capture opens the camera on a phone; the other picks from the library or files. -->
      <input ref="camera" class="visually-hidden" type="file" accept="image/*" capture="environment" tabindex="-1" @change="picked" />
      <input ref="chooser" class="visually-hidden" type="file" accept="image/*" multiple tabindex="-1" @change="picked" />
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="camera?.click()">Take photo</button>
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="chooser?.click()">Choose photos</button>
    </div>
    <p v-else class="muted small">{{ MAX_PHOTOS }} photos, the most a bean can have.</p>
    <p v-if="busy" class="muted small" aria-live="polite">Saving photos…</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.tiles {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: var(--space-3);
}
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.tile img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--brand-tint);
}
.cover-badge {
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
}
.tile-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-1);
}
.pick {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
