<script setup lang="ts">
// The coffee's flavors (docs/api/brew-logs.md §6, "flavors"), picked on the
// workspace's wheel (docs/api/flavor-lexicon.md §2c): tap a segment to zoom
// into it, then tap the centre to pick it; an outermost flavor is picked
// straight away. Picks show as chips. A search box, and a plain list instead
// of the wheel, for anyone who'd rather not use it (and for screen readers).
import { computed, ref, watch } from 'vue';
import type { FlavorPick } from '../api/types';
import { useFlavorWheel } from '../composables/useFlavorWheel';
import { segmentLabel, segmentPath, WHEEL_RADII, wheelSegments, type FlavorNode, type WheelSegment } from '../lib/flavors';

const model = defineModel<string[]>({ required: true });
// saved: the brew's picks as stored, for the label of one the wheel no
// longer has (it was replaced since).
const props = defineProps<{ label?: string; saved?: readonly FlavorPick[] }>();
const { wheel } = useFlavorWheel();

// The wheel or the list, remembered on this device.
const VIEW_KEY = 'flavorView';
function savedView(): 'wheel' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'wheel';
  } catch {
    return 'wheel';
  }
}
const view = ref<'wheel' | 'list'>(savedView());
watch(view, (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // Not remembering is fine.
  }
});

const picked = computed(() => new Set(model.value));
// Segments holding a pick further out, so the way back to it shows.
const holdsPick = computed(() => new Set(model.value.flatMap((key) => wheel.value.path(key).map((n) => n.key))));
const savedLabels = computed(() => new Map((props.saved ?? []).map((p) => [p.key, p.label])));
const labelOf = (key: string) => wheel.value.node(key)?.label ?? savedLabels.value.get(key) ?? key;
const colorOf = (key: string) => wheel.value.node(key)?.color ?? 'var(--text-muted)';
const placeOf = (key: string) => (wheel.value.node(key) ? wheel.value.place(key) : 'Not on the current wheel');

function toggle(key: string): void {
  model.value = picked.value.has(key) ? model.value.filter((k) => k !== key) : wheel.value.sort([...model.value, key]);
}

// ---- Wheel ----
const focus = ref<string | null>(null);
watch(wheel, () => (focus.value = null)); // another wheel was loaded
const focusNode = computed(() => (focus.value ? wheel.value.node(focus.value) : undefined));
const shapes = computed(() => wheelSegments(wheel.value, focus.value).map((s) => ({ ...s, path: segmentPath(s), text: segmentLabel(s) })));
// Picks drawn last, so their outline isn't painted over by a neighbour.
const segments = computed(() => [...shapes.value].sort((a, b) => Number(picked.value.has(a.node.key)) - Number(picked.value.has(b.node.key))));
const trail = computed(() => (focusNode.value ? [...wheel.value.path(focusNode.value.key), focusNode.value] : []));

function tapSegment(s: WheelSegment): void {
  if (s.node.children.length) focus.value = s.node.key;
  else toggle(s.node.key);
}
function segmentAction(n: FlavorNode): string {
  if (n.children.length) return `${n.label}: show its flavors`;
  return `${n.label}: ${picked.value.has(n.key) ? 'picked, tap to remove' : 'pick'}`;
}

// ---- Search ----
const query = ref('');
const results = computed(() => wheel.value.search(query.value).slice(0, 12));
</script>

<template>
  <fieldset class="flavors">
    <legend>{{ label ?? 'Flavors' }} <span class="muted">(optional)</span></legend>

    <ul v-if="model.length" class="chips" aria-label="Picked flavors">
      <li v-for="key in model" :key="key" class="badge chip" :title="placeOf(key) || undefined">
        <span class="swatch" :style="{ background: colorOf(key) }" aria-hidden="true" />
        {{ labelOf(key) }}
        <button type="button" class="remove" :aria-label="`Remove ${labelOf(key)}`" @click="toggle(key)">×</button>
      </li>
    </ul>

    <div class="search">
      <label class="visually-hidden" for="flavor-search">Find a flavor</label>
      <input id="flavor-search" v-model="query" type="search" placeholder="Find a flavor, e.g. cherry" autocomplete="off" />
      <div class="view-switch" role="group" aria-label="Show flavors as">
        <button type="button" class="btn-link" :aria-pressed="view === 'wheel'" @click="view = 'wheel'">Wheel</button>
        <button type="button" class="btn-link" :aria-pressed="view === 'list'" @click="view = 'list'">List</button>
      </div>
    </div>
    <ul v-if="query.trim()" class="options" aria-label="Matching flavors">
      <li v-for="key in results" :key="key">
        <button type="button" class="option" :aria-pressed="picked.has(key)" @click="toggle(key)">
          <span class="swatch" :style="{ background: colorOf(key) }" aria-hidden="true" />
          {{ labelOf(key) }}<span v-if="wheel.place(key)" class="muted small"> · {{ wheel.place(key) }}</span>
        </button>
      </li>
      <li v-if="!results.length" class="muted small">No flavor on the wheel matches; tasting notes take anything.</li>
    </ul>

    <template v-else-if="view === 'wheel'">
      <nav class="trail" aria-label="Wheel position">
        <button type="button" class="btn-link" :disabled="!focus" @click="focus = null">All flavors</button>
        <template v-for="n in trail" :key="n.key">
          <span aria-hidden="true">›</span>
          <button type="button" class="btn-link" :disabled="n.key === focus" @click="focus = n.key">{{ n.label }}</button>
        </template>
      </nav>
      <svg class="wheel" viewBox="-100 -100 200 200" role="group" :aria-label="focusNode ? `${focusNode.label} on the flavor wheel` : wheel.name">
        <g
          v-for="s in segments"
          :key="s.node.key"
          class="segment"
          :class="{ picked: picked.has(s.node.key), holds: holdsPick.has(s.node.key) }"
          role="button"
          tabindex="0"
          :aria-label="segmentAction(s.node)"
          :aria-pressed="s.node.children.length ? undefined : picked.has(s.node.key)"
          @click="tapSegment(s)"
          @keydown.enter.prevent="tapSegment(s)"
          @keydown.space.prevent="tapSegment(s)"
        >
          <path :d="s.path" :fill="s.node.color" />
          <text
            v-if="s.text"
            :transform="`translate(${s.text.x.toFixed(2)} ${s.text.y.toFixed(2)}) rotate(${s.text.rotate.toFixed(1)})`"
            :font-size="s.text.size.toFixed(2)"
            :fill="s.node.ink"
            text-anchor="middle"
            aria-hidden="true"
          >
            <tspan v-for="(line, i) in s.text.lines" :key="i" x="0" :dy="i === 0 ? `${0.35 - (s.text.lines.length - 1) * 0.55}em` : '1.1em'">
              {{ i === 0 && picked.has(s.node.key) ? '✓ ' : '' }}{{ line }}
            </tspan>
          </text>
        </g>
        <!-- The centre: the flavor zoomed into, tapped to pick it. -->
        <g
          v-if="focusNode"
          class="segment center"
          :class="{ picked: picked.has(focusNode.key) }"
          role="button"
          tabindex="0"
          :aria-label="`${focusNode.label}: ${picked.has(focusNode.key) ? 'picked, tap to remove' : 'pick'}`"
          :aria-pressed="picked.has(focusNode.key)"
          @click="toggle(focusNode.key)"
          @keydown.enter.prevent="toggle(focusNode.key)"
          @keydown.space.prevent="toggle(focusNode.key)"
        >
          <circle :r="WHEEL_RADII.center - 1" :fill="picked.has(focusNode.key) ? focusNode.color : 'var(--surface)'" :stroke="focusNode.color" stroke-width="2" />
          <text text-anchor="middle" font-size="6" font-weight="600" :fill="picked.has(focusNode.key) ? focusNode.ink : 'var(--text)'" aria-hidden="true">
            <tspan x="0" dy="-0.2em">{{ picked.has(focusNode.key) ? '✓ ' : '' }}{{ focusNode.label }}</tspan>
            <tspan x="0" dy="1.4em" font-size="4.5" font-weight="400">{{ picked.has(focusNode.key) ? 'tap to remove' : 'tap to pick' }}</tspan>
          </text>
        </g>
        <text v-else text-anchor="middle" font-size="5" fill="var(--text-muted)" aria-hidden="true">
          <tspan x="0" dy="-0.2em">Tap to</tspan>
          <tspan x="0" dy="1.2em">zoom in</tspan>
        </text>
      </svg>
    </template>

    <div v-else class="list">
      <details v-for="cat in wheel.roots" :key="cat.key" :open="holdsPick.has(cat.key) || picked.has(cat.key)">
        <summary>
          <span class="swatch" :style="{ background: cat.color }" aria-hidden="true" />
          {{ cat.label }}
        </summary>
        <div class="options">
          <button type="button" class="option" :aria-pressed="picked.has(cat.key)" @click="toggle(cat.key)">{{ cat.label }} <span class="muted small">(in general)</span></button>
        </div>
        <div v-for="group in cat.children" :key="group.key" class="group">
          <div class="options">
            <button type="button" class="option strong" :aria-pressed="picked.has(group.key)" @click="toggle(group.key)">{{ group.label }}</button>
            <button v-for="f in group.children" :key="f.key" type="button" class="option" :aria-pressed="picked.has(f.key)" @click="toggle(f.key)">{{ f.label }}</button>
          </div>
        </div>
      </details>
    </div>
  </fieldset>
</template>

<style scoped>
.flavors {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.flavors > legend {
  font-weight: 600;
  font-size: 0.9rem;
  padding: 0;
  margin-bottom: var(--space-1);
}
.chips,
.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: 0.875rem;
  padding-right: 0;
}
.swatch {
  display: inline-block;
  flex: none;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
}
.remove {
  min-width: 2rem;
  min-height: 2rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}
.search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.search input {
  flex: 1;
  min-width: 0;
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  font-size: max(1rem, 16px);
  background: var(--surface);
  color: var(--text);
}
.view-switch {
  display: flex;
}
.view-switch .btn-link {
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-weight: 400;
}
.view-switch .btn-link[aria-pressed='true'] {
  color: var(--brand);
  font-weight: 600;
  text-decoration: underline;
}
.option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 2.25rem;
  padding: 0 var(--space-3);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}
.option.strong {
  font-weight: 600;
}
.option[aria-pressed='true'] {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--on-brand);
}
.option[aria-pressed='true'] .muted {
  color: inherit;
}
.trail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--space-1);
  color: var(--text-muted);
}
.trail .btn-link {
  padding: 0 var(--space-1);
}
.trail .btn-link:disabled {
  color: var(--text);
  cursor: default;
}
.wheel {
  display: block;
  width: 100%;
  max-width: 26rem;
  margin: 0 auto;
  touch-action: manipulation;
  user-select: none;
}
.segment {
  cursor: pointer;
  outline: none;
}
.segment path {
  stroke: var(--surface);
  stroke-width: 0.8;
}
.segment:hover path,
.segment:focus-visible path {
  filter: brightness(0.92);
}
.segment:focus-visible path,
.segment:focus-visible circle {
  stroke: var(--focus);
  stroke-width: 2;
}
.segment.picked path {
  stroke: var(--text);
  stroke-width: 1.6;
}
.segment.holds text {
  font-weight: 700;
}
.segment text {
  pointer-events: none;
}
.list details {
  border-top: 1px solid var(--border);
  padding: var(--space-1) 0;
}
.list summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--tap);
  font-weight: 600;
  cursor: pointer;
}
.list .options {
  margin-bottom: var(--space-2);
}
.group {
  padding-left: var(--space-3);
}
</style>
