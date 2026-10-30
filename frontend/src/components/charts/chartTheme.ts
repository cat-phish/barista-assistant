// Chart colours from the theme tokens (styles/base.css), re-read when the
// theme changes, so charts follow light and dark like the rest of the app.
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

export const SERIES_SLOTS = 8;

export interface ChartColors {
  series: string[]; // --series-1 … --series-8, in their fixed order
  text: string;
  muted: string;
  grid: string;
  surface: string;
}

export function readChartColors(): ChartColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: Array.from({ length: SERIES_SLOTS }, (_, i) => v(`--series-${i + 1}`)),
    text: v('--text'),
    muted: v('--text-muted'),
    grid: v('--border'),
    surface: v('--surface'),
  };
}

// The current colours, updated on a Theme change (data-theme on <html>) or the device's.
export function useChartColors(): Ref<ChartColors> {
  const colors = ref<ChartColors>(readChartColors());
  const update = () => (colors.value = readChartColors());
  const observer = new MutationObserver(update);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  onMounted(() => {
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    media.addEventListener('change', update);
  });
  onBeforeUnmount(() => {
    observer.disconnect();
    media.removeEventListener('change', update);
  });
  return colors;
}
