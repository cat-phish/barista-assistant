import { defineStore } from 'pinia';
import { ref } from 'vue';

// An unsaved Add bean form, kept in memory while you're elsewhere in the app
// (e.g. starting a timer while the label is read, stores/labelRead.ts), so
// coming back carries on where you left it. Saving, Cancel and Start over
// clear it; a reload loses it.
export interface BeanDraft {
  workspaceId: string;
  from: string | null; // Duplicate's ?from bean; null for Add bean
  values: Record<string, unknown>; // the form's fields, by name (BeanFormView)
  photos: File[]; // picked bean photos, not uploaded yet
  labelPhotos: File[]; // photos taken just for the label read
}

export const useBeanDraftStore = defineStore('beanDraft', () => {
  const draft = ref<BeanDraft | null>(null);
  function keep(next: BeanDraft): void {
    draft.value = next;
  }
  function clear(): void {
    draft.value = null;
  }
  return { draft, keep, clear };
});
