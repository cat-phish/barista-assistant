import { computed, ref } from 'vue';
import { hasValue, isShown, type FieldKey } from '../lib/fields';
import { usePreferences } from './usePreferences';

// Which optional fields a form shows (lib/fields.ts). Call reveal() with the
// record's values when the form opens: hidden fields that have one stay
// shown for this form, even if the value is cleared while editing.
export function useFieldVisibility() {
  const { hiddenFields } = usePreferences();
  const hidden = computed(() => new Set(hiddenFields.value));
  const revealed = ref(new Set<string>());
  function reveal(values: Partial<Record<FieldKey, unknown>>): void {
    const next = new Set(revealed.value);
    for (const [key, value] of Object.entries(values)) if (hasValue(value)) next.add(key);
    revealed.value = next;
  }
  function show(key: FieldKey): boolean {
    return isShown(key, hidden.value, revealed.value);
  }
  return { show, reveal };
}
