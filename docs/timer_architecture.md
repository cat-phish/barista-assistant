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

## 3. Timer State Mechanics (`PourOverTimer.vue`)
*   **Delta-Timestamp Calculation:** Never increment a counter inside `setInterval`. Store `startTime = Date.now() - elapsedMs` and compute `elapsedMs = Date.now() - startTime` inside a `requestAnimationFrame` loop.
*   **Screen Wake Lock:** Request `navigator.wakeLock.request('screen')` when the brew starts and release it when finished or unmounted.
*   **Clock-driven steps** (supersedes the reference component's manual "Next Step" button): recipe steps have a `stepType`, optional `label`, `startSec` and `endSec` (`docs/api_spec.md` §5). The timer derives everything from the elapsed time; nothing advances on taps:
    *   **Current step** = the step whose window contains the elapsed time (`startSec ≤ t < endSec`). Show its type/label and, for water steps, "Pour to {targetWaterGrams} g (+{amount} g)" plus "until m:ss".
    *   **Between steps** (a gap): show **Wait** with a countdown to the next step's start and a preview of it ("Pour to 250 g at 1:30, in 0:12").
    *   **After the last step:** show "Drawdown / finishing".
    *   **Target finish window** (recipe's `expectedFinishMinSec`–`expectedFinishMaxSec`, if set), shown throughout: "Target 2:45–3:15 · in 0:40" before the window, "· in the window" inside it, "· 0:12 over" after it.
    *   **Finish & Save** is available from the start, since a brew can end earlier or later than planned. It emits the elapsed seconds.
    *   A recipe with no steps works as a plain stopwatch.
    *   Instant steps (`startSec === endSec`, e.g. a quick swirl) show for about two seconds, so they aren't missed.

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
