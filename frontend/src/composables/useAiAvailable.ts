import { computed, ref, watch, type ComputedRef } from 'vue';
import { workspacesApi } from '../api/workspaces';
import { useWorkspaceStore } from '../stores/workspace';

// Whether anything answers this workspace's AI jobs (docs/api/workspaces.md
// §2d), to hide what would only be refused. Assumed yes until known, and
// when it can't be checked: the API still says no.
const known = ref<Record<string, boolean>>({});

export async function refreshAiAvailable(workspaceId: string): Promise<void> {
  try {
    known.value = { ...known.value, [workspaceId]: (await workspacesApi.aiConfig(workspaceId)).available };
  } catch {
    // Left as it was.
  }
}

export function useAiAvailable(): ComputedRef<boolean> {
  const workspaces = useWorkspaceStore();
  watch(
    () => workspaces.current?.id,
    (id) => {
      if (id) void refreshAiAvailable(id);
    },
    { immediate: true },
  );
  return computed(() => known.value[workspaces.current?.id ?? ''] ?? true);
}
