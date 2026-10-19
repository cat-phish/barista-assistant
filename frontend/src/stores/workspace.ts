import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { WorkspaceWithRole } from '../api/types';
import { workspacesApi } from '../api/workspaces';

// Remembers the selected workspace per browser (a convenience only; the
// server decides access). Storage can be unavailable, e.g. private mode.
const STORAGE_KEY = 'brewlog.workspaceId';
function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function save(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembering the choice is fine.
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<WorkspaceWithRole[]>([]);
  const loaded = ref(false);
  const currentId = ref<string | null>(readSaved());

  // Only a workspace the user still belongs to counts as selected.
  const current = computed(() => workspaces.value.find((w) => w.id === currentId.value) ?? null);
  // Owners and baristas can create/edit; viewers are read-only (§0). The UI
  // hides what would fail; the server enforces it regardless.
  const canEdit = computed(() => current.value?.role === 'owner' || current.value?.role === 'barista');

  async function load(): Promise<void> {
    workspaces.value = (await workspacesApi.list()).workspaces;
    loaded.value = true;
    if (!current.value) {
      // Saved choice is gone (left or deleted): fall back to the only one, if exactly one.
      select(workspaces.value.length === 1 ? (workspaces.value[0]?.id ?? null) : null);
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (!loaded.value) await load();
  }

  async function create(name: string, slug: string): Promise<void> {
    const { workspace } = await workspacesApi.create(name, slug);
    await load();
    select(workspace.id);
  }

  function select(id: string | null): void {
    currentId.value = id;
    save(id);
  }

  // Drops the loaded list. An explicit logout also forgets the remembered
  // choice; an expired session keeps it, since the same person usually logs
  // straight back in.
  function reset({ forgetSelection }: { forgetSelection: boolean }): void {
    workspaces.value = [];
    loaded.value = false;
    if (forgetSelection) select(null);
  }

  return { workspaces, loaded, current, canEdit, load, ensureLoaded, create, select, reset };
});
