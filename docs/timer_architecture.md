# Frontend PWA & Pour-Over Timer Architecture

## 1. Viewport & Touch Accessibility Rules
*   **DO NOT** use `maximum-scale=1.0` or `user-scalable=no` in `frontend/index.html`. Keep the standard viewport meta tag:
    ```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#3e2723" />
    ```
*   To prevent accidental double-tap zooming and eliminate the 300ms tap delay on mobile devices during timed pours, apply `touch-action: manipulation;` to all interactive elements (`button`, `input`, `select`).

## 2. Vite PWA Configuration (`frontend/vite.config.ts`)
Use `vite-plugin-pwa` with `registerType: 'autoUpdate'` and Workbox `NetworkFirst` runtime caching on `/api/public/menu/.*`:

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Coffee Brew Journal',
        short_name: 'BrewLog',
        description: 'Self-hosted pour-over timer and LLM extraction analysis',
        theme_color: '#3e2723',
        background_color: '#f5f5f5',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/public\/menu\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'public-menu-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
});
```

## 3. Timer State Mechanics (`BrewTimer.vue`, every recipe)
*   **Delta-Timestamp Calculation:** Never increment a counter inside `setInterval`. Store `startTime = Date.now() - elapsedMs` and compute `elapsedMs = Date.now() - startTime` inside a `requestAnimationFrame` loop.
*   **Screen Wake Lock:** Request `navigator.wakeLock.request('screen')` when the brew starts and release it when finished or unmounted.
*   **Steps run back to back** (supersedes the reference component's manual "Next Step" button and the earlier fixed start/end times). Recipe steps have a `durationSec` and an `advance` mode (`docs/api/README.md` §5); each step starts when the previous one actually ended:
    *   `auto`: ends `durationSec` after it started. An instant step (0 s) is shown for about two seconds without delaying the next one.
    *   `auto_log`: the same, with a **Log it** button that records a `step_end` mark (the real moment, e.g. when you actually poured) without changing the schedule.
    *   `tap`: ends when **Next** is tapped (recorded as a `step_end` mark). Its duration is a guide: once passed, the card says "Tap Next when ready".
    *   `first_drop` (espresso): ends when **First drop** is tapped. A first drop tapped before this step starts ends it as soon as it starts.
    *   A last step with no duration runs until **Finish & Save**; after a timed last step the card shows "All steps done".
    *   The schedule is a pure function, `brewSchedule(steps, t, marks)` in `lib/steps.ts`, unit-tested.
*   **Layout, top to bottom:** header, the step cards, the buttons (Start / Finish & Save / First drop), then the clock. Steps come first because they say what to do; before the start there are no cards, so it's the buttons and the clock.
*   **Cards:** **Previous** → **Current** → **Up next**, the same structure for every step so the layout doesn't jump. Current shows a label line ("Step 2 of 4 · Pour · 93 °C"), a big line, a small line and a progress bar:
    *   Big, left: the instruction ("Pour to 150 g (+100)", "9 bar", "9 → 6 bar", "4 → 2 g/s", "Pump off"), or the step's name when it has none. The name goes on the small line under it.
    *   Big, right: a countdown ("0:20", small "left"; for a tap step's guide "left (guide)", then "Tap Next"), or "At first drop" / "Until done".
    *   Previous / Up next are one line each with the instruction in bold ("Pour · **Pour to 210 g (+150)** · 0:30 · at 1:23").
    *   Progress runs from the step's start to its planned end (the guide for tap steps, the first-drop window's end for first-drop steps).
    *   Steps you're doing get the warm brand-tint background; waiting steps (`wait`, `soak`) are plain white.
    *   If the espresso brewer (the recipe's) can't control what a step asks for (pressure/flow `none`), the card adds "Your machine can't set pressure", and the step still runs on time.
*   **Espresso** adds a **First drop** button under Finish & Save while running (whether or not a step waits for it). After the tap it shows the time and "early / in the window / late" against the recipe's window, with a way to re-record. With no steps the shot timer is just the clock and this button.
*   **Target finish window** (recipe's `expectedFinishMinSec`–`expectedFinishMaxSec`, if set) under the clock: "Target 2:45–3:15 · in 0:40" before the window, "· in the window" inside it, "· 0:12 over" after it. Espresso headers show "18 g → 36 g".
*   **Finish & Save** is available from the start. It emits the elapsed seconds and the marks; the log form has a **First drop** field (espresso), filled from the tap or typed in afterwards, and blank = not recorded.
*   **Scaled batches:** brew setup can scale the recipe (dose, water or yield; `docs/roadmap.md` phase 1). The timer receives the scaled steps: pour targets × (batch water / recipe water), rounded to whole grams; durations unchanged. The header shows the batch dose.
*   **Layout:** **Cancel brew** (in `BrewView`) → recipe header → clock with the target-finish note → **Start / Finish & Save** (→ **First drop** for espresso) → Previous → Current → Up next. Everything stays on screen on a phone (390×844) without scrolling.

### Reference Component Implementation (`frontend/src/components/PourOverTimer.vue`)

```vue
<template>
  <div class="timer-container">
    <header class="timer-header">
      <h2>{{ recipeName }}</h2>
      <p class="subtitle">{{ beanName }} • {{ targetDose }}g dose</p>
    </header>

    <div class="clock-display">
      <span class="time">{{ formattedTime }}</span>
    </div>

    <div v-if="currentStep" class="step-card active-step">
      <h3>{{ currentStep.actionName }}</h3>
      <div class="step-metrics">
        <div class="metric">
          <span class="label">Target Weight</span>
          <span class="value">{{ currentStep.targetWaterGrams }}g</span>
        </div>
        <div class="metric">
          <span class="label">Target Time</span>
          <span class="value">0:{{ currentStep.targetTimeSec.toString().padStart(2, '0') }}</span>
        </div>
      </div>
    </div>

    <div v-if="nextStepPreview" class="step-card next-step">
      <span class="label">Up Next:</span>
      <span>{{ nextStepPreview.actionName }} to {{ nextStepPreview.targetWaterGrams }}g</span>
    </div>

    <div class="controls">
      <button v-if="!isRunning && elapsedMs === 0" @click="startTimer" class="btn primary">
        Start Brew
      </button>
      <button v-else-if="isRunning && nextStepPreview" @click="advanceStep" class="btn secondary">
        Next Step
      </button>
      <button v-else-if="isRunning && !nextStepPreview" @click="finishBrew" class="btn success">
        Finish & Save
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';

export interface RecipeStep {
  stepOrder: number;
  actionName: string;
  targetTimeSec: number;
  targetWaterGrams: number;
}

const props = defineProps<{
  recipeName: string;
  beanName: string;
  targetDose: number;
  steps: RecipeStep[];
}>();

const emit = defineEmits<{
  (e: 'complete', actualTimeSec: number): void;
}>();

const isRunning = ref(false);
const startTime = ref(0);
const elapsedMs = ref(0);
const currentStepIndex = ref(0);
let animationFrameId: number | null = null;
let wakeLock: WakeLockSentinel | null = null;

const currentStep = computed(() => props.steps[currentStepIndex.value]);
const nextStepPreview = computed(() => props.steps[currentStepIndex.value + 1]);

const formattedTime = computed(() => {
  const totalSeconds = Math.floor(elapsedMs.value / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
});

const tick = () => {
  if (!isRunning.value) return;
  elapsedMs.value = Date.now() - startTime.value;
  animationFrameId = requestAnimationFrame(tick);
};

const requestWakeLock = async () => {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.warn('Wake Lock request failed:', err);
  }
};

const releaseWakeLock = async () => {
  if (wakeLock !== null) {
    await wakeLock.release();
    wakeLock = null;
  }
};

const startTimer = async () => {
  startTime.value = Date.now() - elapsedMs.value;
  isRunning.value = true;
  await requestWakeLock();
  animationFrameId = requestAnimationFrame(tick);
};

const advanceStep = () => {
  if (currentStepIndex.value < props.steps.length - 1) {
    currentStepIndex.value++;
  }
};

const finishBrew = async () => {
  isRunning.value = false;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  await releaseWakeLock();
  emit('complete', Math.floor(elapsedMs.value / 1000));
};

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  releaseWakeLock();
});
</script>

<style scoped>
.timer-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.5rem;
  max-width: 500px;
  margin: 0 auto;
}
.clock-display {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem;
  background: #f5f5f5;
  border-radius: 12px;
}
.time {
  font-size: 4rem;
  font-variant-numeric: tabular-nums;
  font-weight: bold;
  color: #3e2723;
}
.step-card {
  padding: 1rem;
  border-radius: 8px;
  background: white;
  border: 1px solid #e0e0e0;
}
.active-step {
  border-left: 4px solid #3e2723;
}
.next-step {
  opacity: 0.7;
  font-size: 0.9rem;
}
.step-metrics {
  display: flex;
  justify-content: space-between;
  margin-top: 1rem;
}
.metric {
  display: flex;
  flex-direction: column;
}
.label {
  font-size: 0.8rem;
  color: #757575;
  text-transform: uppercase;
}
.value {
  font-size: 1.2rem;
  font-weight: 600;
}
.controls button {
  width: 100%;
  padding: 1rem;
  font-size: 1.2rem;
  border-radius: 8px;
  border: none;
  font-weight: bold;
  cursor: pointer;
  touch-action: manipulation;
}
.btn.primary { background: #3e2723; color: white; }
.btn.secondary { background: #e0e0e0; color: #333; }
.btn.success { background: #2e7d32; color: white; }
</style>
```
