import { computed, ref, watch } from 'vue';
import { flavorLexiconApi } from '../api/flavorLexicon';
import type { WorkspaceLexicon } from '../api/types';
import { buildWheel, DEFAULT_WHEEL, type Wheel } from '../lib/flavors';
import { useWorkspaceStore } from '../stores/workspace';

// The current workspace's flavor wheel (docs/api/flavor-lexicon.md §2c),
// loaded once per workspace and shared by every form; the built-in wheel
// until it arrives (or when offline).
const loaded = ref(new Map<string, { info: WorkspaceLexicon; wheel: Wheel }>());
const pending = new Set<string>();

async function load(workspaceId: string, force = false): Promise<void> {
  if (pending.has(workspaceId) || (!force && loaded.value.has(workspaceId))) return;
  pending.add(workspaceId);
  try {
    const info = await flavorLexiconApi.get(workspaceId);
    setLexicon(workspaceId, info);
  } catch {
    // Keep the built-in wheel; the next form opened tries again.
  } finally {
    pending.delete(workspaceId);
  }
}

// After an import or reset (Settings), so forms use the new wheel at once.
export function setLexicon(workspaceId: string, info: WorkspaceLexicon): void {
  const next = new Map(loaded.value);
  next.set(workspaceId, { info, wheel: buildWheel(info.lexicon) });
  loaded.value = next;
}

export function useFlavorWheel() {
  const workspaces = useWorkspaceStore();
  const id = computed(() => workspaces.current?.id ?? null);
  watch(id, (ws) => ws && void load(ws), { immediate: true });
  const entry = computed(() => (id.value ? loaded.value.get(id.value) : undefined));
  return {
    wheel: computed(() => entry.value?.wheel ?? DEFAULT_WHEEL),
    info: computed(() => entry.value?.info ?? null),
    reload: () => id.value && load(id.value, true),
  };
}
