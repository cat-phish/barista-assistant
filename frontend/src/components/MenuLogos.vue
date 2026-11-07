<script setup lang="ts">
// The menu's logos in Settings → Workspace (docs/api/menu.md §7b): up to 6,
// drag ⠿ to reorder, and the first is the one the menu shows; the others are
// kept to swap in. Crop opens PhotoCropDialog, keeping a see-through
// background, and the cropped image replaces the logo in place. Every
// change saves straight away and hands back the menu.
import { computed, ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { errorMessage } from '../api/client';
import { menuApi } from '../api/menu';
import type { Menu } from '../api/types';
import { useReorder } from '../composables/useReorder';
import PhotoCropDialog from './PhotoCropDialog.vue';
import ReorderHandle from './ReorderHandle.vue';

const MAX_LOGOS = 6; // MAX_MENU_LOGOS in @barista/shared/schema

const props = defineProps<{
  workspaceId: string;
  slug: string;
  logoIds: string[];
  canEdit: boolean;
}>();
const emit = defineEmits<{ (e: 'saved', menu: Menu): void }>();

const busy = ref(false);
const error = ref('');
const chooser = ref<HTMLInputElement | null>(null);

interface Tile {
  id: string;
  name: string; // "Logo 2", for the handle and announcements
  src: string;
}
const fromIds = (): Tile[] => props.logoIds.map((id, i) => ({ id, name: `Logo ${i + 1}`, src: menuApi.logoUrl(props.slug, id) }));
// What's on screen; moved straight away when dragged, then saved.
const tiles = ref<Tile[]>([]);
watch(() => [props.logoIds, props.slug], () => (tiles.value = fromIds()), { immediate: true, deep: true });
const room = computed(() => MAX_LOGOS - tiles.value.length);

// Runs a change and hands the menu back; false if it failed.
async function save(change: () => Promise<Menu>): Promise<boolean> {
  busy.value = true;
  error.value = '';
  try {
    emit('saved', await change());
    return true;
  } catch (err) {
    error.value = errorMessage(err);
    return false;
  } finally {
    busy.value = false;
  }
}

const reorderDisabled = computed(() => busy.value || !props.canEdit || tiles.value.length < 2);
const { announcement, onDragUpdate, move } = useReorder({
  items: tiles,
  visible: () => tiles.value,
  disabled: () => reorderDisabled.value,
  save: (next) => save(() => menuApi.reorderLogos(props.workspaceId, next.map((t) => t.id))),
});

async function picked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = ''; // the same file can be picked again
  if (files.length === 0) return;
  const take = files.slice(0, Math.max(0, room.value));
  const left = files.length - take.length;
  for (const file of take) if (!(await save(() => menuApi.addLogo(props.workspaceId, file)))) return;
  if (left > 0) error.value = `A menu keeps at most ${MAX_LOGOS} logos; ${left} left out.`;
}

const remove = (t: Tile) => save(() => menuApi.removeLogo(props.workspaceId, t.id));

// The logo being cropped, and its image.
const cropping = ref<{ id: string; source: Blob } | null>(null);
async function crop(t: Tile): Promise<void> {
  error.value = '';
  try {
    const res = await fetch(t.src);
    if (!res.ok) throw new Error('The logo couldn’t be loaded');
    cropping.value = { id: t.id, source: await res.blob() };
  } catch (err) {
    error.value = errorMessage(err);
  }
}
async function cropped(image: Blob): Promise<void> {
  const target = cropping.value;
  cropping.value = null;
  if (target) await save(() => menuApi.replaceLogo(props.workspaceId, target.id, image));
}
</script>

<template>
  <div class="menu-logos stack">
    <input ref="chooser" class="visually-hidden" type="file" accept="image/*" multiple tabindex="-1" @change="picked" />
    <span class="visually-hidden" aria-live="polite">{{ announcement }}</span>
    <VueDraggable
      v-if="tiles.length"
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
        <span v-if="i === 0 && tiles.length > 1" class="badge shown-badge">On the menu</span>
        <template v-if="canEdit">
          <ReorderHandle v-if="tiles.length > 1" class="tile-handle" :name="t.name" :disabled="reorderDisabled" @move="move(i, $event)" />
          <button type="button" class="tile-remove" :disabled="busy" :aria-label="`Remove ${t.name.toLowerCase()}`" @click="remove(t)">✕</button>
          <button type="button" class="tile-crop" :disabled="busy" :aria-label="`Crop ${t.name.toLowerCase()}`" title="Crop or rotate" @click="crop(t)">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 2v14a2 2 0 0 0 2 2h14" />
              <path d="M18 22V8a2 2 0 0 0-2-2H2" />
            </svg>
          </button>
        </template>
      </li>
    </VueDraggable>
    <p v-else class="muted small">No logo.</p>
    <p v-if="tiles.length > 1 && canEdit" class="hint">Drag ⠿ to reorder: the first shows above the title, the others are kept to swap in.</p>
    <p v-else-if="canEdit" class="hint">Shown above the title. A PNG with a transparent background looks best.</p>
    <template v-if="canEdit">
      <div v-if="room > 0">
        <button type="button" class="btn btn-secondary" :disabled="busy" @click="chooser?.click()">{{ tiles.length ? 'Add logos' : 'Upload' }}</button>
      </div>
      <p v-else class="muted small">{{ MAX_LOGOS }} logos, the most a menu keeps.</p>
    </template>
    <p v-if="busy" class="muted small" aria-live="polite">Saving…</p>
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    <PhotoCropDialog :open="!!cropping" :source="cropping?.source ?? null" saved transparent @done="cropped" @cancel="cropping = null" />
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
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: var(--space-2);
}
.tile {
  position: relative;
}
/* The whole logo, on a checkerboard so a transparent one shows as such. */
.tile img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  padding: var(--space-2);
  box-sizing: border-box;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: repeating-conic-gradient(var(--brand-tint) 0% 25%, var(--surface, #fff) 0% 50%) 50% / 16px 16px;
}
.shown-badge {
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
}
/* Over the logo, on a light chip so they show on any image. */
.tile .tile-handle,
.tile .tile-remove,
.tile .tile-crop {
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
.tile .tile-remove,
.tile .tile-crop {
  right: var(--space-1);
  border: none;
  cursor: pointer;
}
.tile .tile-crop {
  top: var(--space-1);
  bottom: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tile .tile-remove:disabled,
.tile .tile-crop:disabled {
  opacity: 0.5;
  cursor: default;
}
.drag-ghost {
  opacity: 0.35;
}
</style>
