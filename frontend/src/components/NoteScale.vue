<script setup lang="ts">
// A note's "Scale for" box (docs/api/notes.md §3h): each "20 g per 1 L" line
// worked out for the volume entered (lib/noteScaling.ts). Nothing is saved
// but the last volume, on this device, per note.
import { computed, ref, watch } from 'vue';
import { usePreferences } from '../composables/usePreferences';
import { parseDecimal } from '../lib/format';
import { recallView, rememberView } from '../lib/listSort';
import { formatScaled, scaledAmount, scalableLines, SCALE_UNITS, type ScaleUnit } from '../lib/noteScaling';

const props = defineProps<{ noteId: string; body: string }>();
const { prefs } = usePreferences();

const lines = computed(() => scalableLines(props.body));
const storageKey = () => `notes.scale.${props.noteId}`;
const isUnit = (v: unknown): v is ScaleUnit => typeof v === 'string' && v in SCALE_UNITS;

function recalled(): { volume: string; unit: ScaleUnit } {
  const fallback = { volume: '1', unit: (prefs.value.volumeUnit === 'fl_oz' ? 'fl_oz' : 'l') as ScaleUnit };
  try {
    const saved: unknown = JSON.parse(recallView(storageKey()) ?? 'null');
    if (saved && typeof saved === 'object') {
      const { volume, unit } = saved as Record<string, unknown>;
      if (typeof volume === 'string' && isUnit(unit)) return { volume, unit };
    }
  } catch {
    // Unreadable: the default.
  }
  return fallback;
}
const start = recalled();
const volume = ref(start.volume);
const unit = ref<ScaleUnit>(start.unit);
watch([volume, unit], () => rememberView(storageKey(), JSON.stringify({ volume: volume.value, unit: unit.value })));

const parsed = computed(() => parseDecimal(volume.value, { scale: 3, min: 0, max: 100000, exclusiveMin: true }));
const results = computed(() =>
  lines.value.map((line) => ({
    ...line,
    scaled: parsed.value.ok ? `${formatScaled(scaledAmount(line, parsed.value.value, unit.value))}${line.unit ? ` ${line.unit}` : ''}` : '–',
  })),
);
const inputId = computed(() => `scale-${props.noteId}`);
</script>

<template>
  <section v-if="lines.length" class="scale" :aria-labelledby="`${inputId}-label`">
    <div class="scale-for">
      <label :id="`${inputId}-label`" :for="inputId">Scale for</label>
      <input :id="inputId" v-model="volume" class="volume" inputmode="decimal" autocomplete="off" :aria-invalid="!parsed.ok" />
      <select v-model="unit" aria-label="Unit">
        <option v-for="(u, key) in SCALE_UNITS" :key="key" :value="key">{{ u.label }}</option>
      </select>
    </div>
    <p v-if="!parsed.ok" class="field-error">{{ parsed.error }}</p>
    <ul class="results" aria-live="polite">
      <li v-for="(r, i) in results" :key="i">
        <span class="label">{{ r.label }}</span>
        <span class="muted small">{{ r.text }}</span>
        <strong class="amount">{{ r.scaled }}</strong>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.scale {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.scale-for {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.volume {
  width: 6rem;
}
.results {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.results li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-2);
}
.label {
  overflow-wrap: anywhere;
}
.amount {
  margin-left: auto;
  white-space: nowrap;
}
.small {
  font-size: 0.85rem;
}
p {
  margin: 0;
}
</style>
