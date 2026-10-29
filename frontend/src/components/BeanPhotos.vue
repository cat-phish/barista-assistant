<script setup lang="ts">
// The Photos card at the top of the bean form (docs/api/bean-photos.md §4c).
// The bean's photos: drag ⠿ to reorder, the first is the cover. Editing a
// saved bean changes them straight away; a new bean holds the picked files
// until it's saved (uploadPending, called by the form once it has the bean's
// id). photoSources hands them to the label reader (LabelCard.vue).
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { beansApi } from '../api/beans';
import { errorMessage } from '../api/client';
import type { BeanPhoto } from '../api/types';
import { useReorder } from '../composables/useReorder';
import ReorderHandle from './ReorderHandle.vue';

const MAX_PHOTOS = 6; // MAX_BEAN_PHOTOS in @barista/shared/schema

const props = defineProps<{ workspaceId: string; beanId: string | null }>();
const photos = defineModel<BeanPhoto[]>({ required: true });

// Picked before the bean exists: shown from the file itself.
interface Pending {
  key: string;
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
  id: string;
  name: string; // "Photo 2", for the handle and announcements
  src: string;
  blob: () => Promise<Blob>;
}
const fromSources = (): Tile[] =>
  props.beanId
    ? photos.value.map((p, i) => ({
        id: p.id,
        name: `Photo ${i + 1}`,
        src: beansApi.photoUrl(props.workspaceId, props.beanId!, p.id),
        blob: async () => {
          const res = await fetch(beansApi.photoUrl(props.workspaceId, props.beanId!, p.id), { credentials: 'include' });
          if (!res.ok) throw new Error('A photo couldn’t be loaded');
          return res.blob();
        },
      }))
    : pending.value.map((p, i) => ({ id: p.key, name: `Photo ${i + 1}`, src: p.url, blob: async () => p.file }));
// What's on screen; moved straight away when dragged, then saved.
const tiles = ref<Tile[]>([]);
watch([photos, pending, () => props.beanId], () => (tiles.value = fromSources()), { immediate: true, deep: true });
const room = computed(() => MAX_PHOTOS - tiles.value.length);

const reorderDisabled = computed(() => busy.value || tiles.value.length < 2);
const { announcement, onDragUpdate, move } = useReorder({
  items: tiles,
  visible: () => tiles.value,
  disabled: () => reorderDisabled.value,
  save: async (next) => {
    const ids = next.map((t) => t.id);
    if (!props.beanId) {
      pending.value = ids.map((id) => pending.value.find((p) => p.key === id)!);
      return true;
    }
    busy.value = true;
    error.value = '';
    try {
      photos.value = (await beansApi.reorderPhotos(props.workspaceId, props.beanId, ids)).photos;
      return true;
    } catch (err) {
      error.value = errorMessage(err);
      return false;
    } finally {
      busy.value = false;
    }
  },
});

function pickedFiles(event: Event): File[] {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = ''; // the same photo can be picked again
  return files;
}

async function picked(event: Event): Promise<void> {
  const files = pickedFiles(event);
  if (files.length === 0) return;
  error.value = files.length > room.value ? `A bean has at most ${MAX_PHOTOS} photos; ${files.length - room.value} left out.` : '';
  const take = files.slice(0, Math.max(0, room.value));
  if (!props.beanId) {
    pending.value = [...pending.value, ...take.map((file) => ({ key: `new-${nextKey++}`, file, url: URL.createObjectURL(file) }))];
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

async function remove(tile: Tile): Promise<void> {
  error.value = '';
  if (!props.beanId) {
    const p = pending.value.find((x) => x.key === tile.id);
    if (p) URL.revokeObjectURL(p.url);
    pending.value = pending.value.filter((x) => x.key !== tile.id);
    return;
  }
  busy.value = true;
  try {
    await beansApi.removePhoto(props.workspaceId, props.beanId, tile.id);
    photos.value = photos.value.filter((p) => p.id !== tile.id);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
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
// The photos, cover first, each loaded when it's needed.
const photoSources = computed(() => tiles.value.map((t) => t.blob));
defineExpose({ uploadPending, photoSources });

onBeforeUnmount(() => pending.value.forEach((p) => URL.revokeObjectURL(p.url)));
</script>

<template>
  <div class="bean-photos stack">
    <!-- capture opens the camera on a phone; the other picks from the library or files. -->
    <input ref="camera" class="visually-hidden" type="file" accept="image/*" capture="environment" tabindex="-1" @change="picked" />
    <input ref="chooser" class="visually-hidden" type="file" accept="image/*" multiple tabindex="-1" @change="picked" />
    <span class="visually-hidden" aria-live="polite">{{ announcement }}</span>
    <VueDraggable
      v-if="tiles.length"
      ref="reorder-list"
      :model-value="tiles"
      tag="ul"
      class="tiles"
      handle=".reorder-handle"
      :animation="150"
      ghost-class="drag-ghost"
      :disabled="reorderDisabled"
      :custom-update="onDragUpdate"
      :aria-busy="busy"
    >
      <li v-for="(t, i) in tiles" :key="t.id" :data-reorder-id="t.id" class="tile">
        <img :src="t.src" :alt="t.name" loading="lazy" />
        <span v-if="i === 0" class="badge cover-badge">Cover</span>
        <ReorderHandle v-if="tiles.length > 1" class="tile-handle" :name="t.name" :disabled="reorderDisabled" @move="move(i, $event)" />
        <button type="button" class="tile-remove" :disabled="busy" :aria-label="`Remove ${t.name.toLowerCase()}`" @click="remove(t)">✕</button>
      </li>
    </VueDraggable>
    <p v-if="tiles.length > 1" class="muted small">Drag ⠿ to reorder; the first is the cover in the bean list.</p>
    <p v-else-if="!tiles.length" class="muted small">A photo of the bag or label, to spot it at a glance.</p>
    <div v-if="room > 0" class="row">
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="camera?.click()">Take photo</button>
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="chooser?.click()">Choose photos</button>
    </div>
    <p v-else class="muted small">{{ MAX_PHOTOS }} photos, the most a bean can have.</p>
    <p v-if="busy" class="muted small" aria-live="polite">Saving photos…</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
p {
  margin: 0;
}
.tiles {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--space-2);
}
.tile {
  position: relative;
}
.tile img {
  display: block;
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
/* Over the photo, on a light chip so they show on any image. */
.tile .tile-handle,
.tile .tile-remove {
  position: absolute;
  bottom: var(--space-1);
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface, #fff) 85%, transparent);
  color: var(--text);
  font-size: 1.1rem;
}
.tile .tile-handle {
  left: var(--space-1);
}
.tile .tile-remove {
  right: var(--space-1);
  border: none;
  cursor: pointer;
}
.tile .tile-remove:disabled {
  opacity: 0.5;
  cursor: default;
}
.drag-ghost {
  opacity: 0.35;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
</style>
