// Insights: an over-time bar chart can be drawn as a line instead, and each
// chart remembers which in this browser (docs/roadmap.md, "Insights").
import { ref, watch, type Ref } from 'vue';
import { recallView, rememberView } from './listSort';

export type SwitchableKind = 'bar' | 'line';

export const chartKindKey = (chart: string) => `insights.chartKind.${chart}`;
export const parseChartKind = (v: string | null): SwitchableKind => (v === 'line' ? 'line' : 'bar');

export function useChartKind(chart: string): Ref<SwitchableKind> {
  const kind = ref<SwitchableKind>(parseChartKind(recallView(chartKindKey(chart))));
  watch(kind, (k) => rememberView(chartKindKey(chart), k));
  return kind;
}
