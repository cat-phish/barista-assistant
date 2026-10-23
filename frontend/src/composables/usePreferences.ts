import { computed } from 'vue';
import type { UserPreferences, WorkspaceSettings } from '../api/types';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore } from '../stores/workspace';

// The defaults match the API's (DEFAULT_PREFERENCES / DEFAULT_WORKSPACE_SETTINGS
// in @barista/shared), for the moment before /me or the workspace has loaded.
export const DEFAULT_PREFERENCES: UserPreferences = {
  volumeUnit: 'fl_oz',
  showBothVolumes: false,
  altitudeUnit: 'm',
  temperatureUnit: 'c',
  theme: 'system',
  rateReminders: true,
  rateReminderMinutes: 15,
};
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = { recipeRoastLevel: 'light', roastScale: 'names', hiddenFields: [] };

// The signed-in person's display units and the current workspace's settings.
export function usePreferences() {
  const auth = useAuthStore();
  const workspaces = useWorkspaceStore();
  const prefs = computed(() => auth.user?.preferences ?? DEFAULT_PREFERENCES);
  const settings = computed(() => workspaces.current?.settings ?? DEFAULT_WORKSPACE_SETTINGS);
  return {
    prefs,
    settings,
    temperatureUnit: computed(() => prefs.value.temperatureUnit),
    altitudeUnit: computed(() => prefs.value.altitudeUnit),
    recipeRoastLevel: computed(() => settings.value.recipeRoastLevel),
    roastScale: computed(() => settings.value.roastScale),
    // Older stored settings may lack it until the API fills in defaults.
    hiddenFields: computed(() => settings.value.hiddenFields ?? []),
  };
}
