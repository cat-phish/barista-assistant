<script setup lang="ts">
// One Chart.js chart for the Insights page: line, bar, doughnut or scatter, in
// the theme's colours (chartTheme.ts). Series take the colour slots in order;
// a slice or series named OTHER is grey, as it isn't one thing.
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
  type Plugin,
  type TooltipItem,
} from 'chart.js';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { OTHER } from '../../lib/stats';
import { useChartColors, type ChartColors } from './chartTheme';

Chart.register(LineController, BarController, DoughnutController, ScatterController, LineElement, PointElement, BarElement, ArcElement, CategoryScale, LinearScale, Filler, Tooltip, Legend);

export interface Series {
  label: string;
  data: Array<number | null>;
}
export interface PointSeries {
  label: string;
  data: Array<{ x: number; y: number }>;
}
export interface Box {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const props = withDefaults(
  defineProps<{
    kind: 'line' | 'bar' | 'doughnut' | 'scatter';
    label: string; // what the chart shows, for screen readers
    labels?: string[]; // categories along x (line, bar), or the slices (doughnut)
    series?: Series[]; // line and bar; a doughnut uses the first
    points?: PointSeries[]; // scatter
    stacked?: boolean;
    horizontal?: boolean; // bar: categories down the side
    fill?: boolean; // line: shade under a single series
    format?: (n: number) => string; // values on the axis and in tooltips
    formatX?: (n: number) => string; // scatter x
    xTitle?: string;
    yTitle?: string;
    yMin?: number;
    yMax?: number;
    box?: Box; // scatter: a shaded target area (EY against TDS)
    height?: number;
  }>(),
  { labels: () => [], series: () => [], points: () => [], height: 240 },
);

const canvas = ref<HTMLCanvasElement | null>(null);
const colors = useChartColors();
let chart: Chart | null = null;

const plain = (n: number) => String(Math.round(n * 100) / 100);
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '–' : (props.format ?? plain)(n));

function slot(c: ChartColors, i: number, label: string): string {
  return label === OTHER ? c.muted : c.series[i % c.series.length]!;
}

// Draws the target box behind a scatter's points.
const boxPlugin: Plugin<'scatter'> = {
  id: 'targetBox',
  beforeDatasetsDraw(ch) {
    const box = props.box;
    if (!box) return;
    const { ctx, scales } = ch;
    const x = scales.x!;
    const y = scales.y!;
    const left = x.getPixelForValue(box.xMin);
    const right = x.getPixelForValue(box.xMax);
    const top = y.getPixelForValue(box.yMax);
    const bottom = y.getPixelForValue(box.yMin);
    ctx.save();
    ctx.fillStyle = colors.value.grid;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.restore();
  },
};

function axes(c: ChartColors) {
  const tick = { color: c.muted, font: { size: 12 } };
  const grid = { color: c.grid };
  const valueAxis = {
    stacked: props.stacked,
    min: props.yMin,
    max: props.yMax,
    beginAtZero: props.kind === 'bar',
    ticks: { ...tick, callback: (v: number | string) => fmt(Number(v)) },
    grid,
    border: { display: false },
    title: { display: !!props.yTitle, text: props.yTitle ?? '', color: c.muted },
  };
  const categoryAxis = {
    stacked: props.stacked,
    ticks: { ...tick, autoSkip: true, maxRotation: 0 },
    grid: { display: false },
    border: { color: c.grid },
    title: { display: !!props.xTitle, text: props.xTitle ?? '', color: c.muted },
  };
  return props.horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis };
}

function common(c: ChartColors, legend: boolean) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    color: c.text,
    plugins: {
      legend: { display: legend, position: 'bottom' as const, labels: { color: c.text, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 2 } },
      tooltip: { backgroundColor: c.surface, titleColor: c.text, bodyColor: c.text, borderColor: c.grid, borderWidth: 1, padding: 8, boxPadding: 4 },
    },
  };
}

function lineConfig(c: ChartColors): ChartConfiguration<'line'> {
  const datasets: ChartDataset<'line'>[] = props.series.map((s, i) => ({
    label: s.label,
    data: s.data,
    borderColor: slot(c, i, s.label),
    backgroundColor: slot(c, i, s.label),
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHitRadius: 12,
    tension: 0.25,
    spanGaps: true,
    fill: props.fill && props.series.length === 1 ? { target: 'origin', above: `${slot(c, i, s.label)}22` } : false,
  }));
  const base = common(c, props.series.length > 1);
  return {
    type: 'line',
    data: { labels: props.labels, datasets },
    options: {
      ...base,
      interaction: { mode: 'index', intersect: false },
      scales: axes(c),
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { label: (t: TooltipItem<'line'>) => ` ${t.dataset.label}: ${fmt(t.parsed.y)}` } } },
    },
  };
}

function barConfig(c: ChartColors): ChartConfiguration<'bar'> {
  const datasets: ChartDataset<'bar'>[] = props.series.map((s, i) => ({
    label: s.label,
    data: s.data,
    backgroundColor: slot(c, i, s.label),
    borderColor: c.surface,
    // Stacked: a 2px gap of the card's colour between segments.
    borderWidth: props.stacked ? (props.horizontal ? { right: 2 } : { top: 2 }) : 0,
    borderRadius: 4,
    borderSkipped: 'start',
    maxBarThickness: 28,
  }));
  const base = common(c, props.series.length > 1);
  const value = (t: TooltipItem<'bar'>) => (props.horizontal ? t.parsed.x : t.parsed.y);
  return {
    type: 'bar',
    data: { labels: props.labels, datasets },
    options: {
      ...base,
      indexAxis: props.horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      scales: axes(c),
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { label: (t: TooltipItem<'bar'>) => ` ${t.dataset.label}: ${fmt(value(t))}` } } },
    },
  };
}

function doughnutConfig(c: ChartColors): ChartConfiguration<'doughnut'> {
  const data = props.series[0]?.data.map((n) => n ?? 0) ?? [];
  const total = data.reduce((a, b) => a + b, 0);
  const base = common(c, true);
  return {
    type: 'doughnut',
    data: {
      labels: props.labels,
      datasets: [{ data, backgroundColor: props.labels.map((l, i) => slot(c, i, l)), borderColor: c.surface, borderWidth: 2, hoverOffset: 4 }],
    },
    options: {
      ...base,
      cutout: '58%',
      plugins: {
        ...base.plugins,
        legend: { ...base.plugins.legend, position: 'right' },
        tooltip: {
          ...base.plugins.tooltip,
          callbacks: { label: (t: TooltipItem<'doughnut'>) => ` ${fmt(t.parsed)} (${total ? Math.round((t.parsed / total) * 100) : 0}%)` },
        },
      },
    },
  };
}

function scatterConfig(c: ChartColors): ChartConfiguration<'scatter'> {
  const datasets: ChartDataset<'scatter'>[] = props.points.map((s, i) => ({
    label: s.label,
    data: s.data,
    backgroundColor: slot(c, i, s.label),
    borderColor: c.surface,
    borderWidth: 1,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointHitRadius: 8,
  }));
  const base = common(c, props.points.length > 1);
  const scales = axes(c);
  const fx = props.formatX ?? plain;
  return {
    type: 'scatter',
    data: { datasets },
    plugins: [boxPlugin],
    options: {
      ...base,
      scales: {
        x: { ...scales.x, type: 'linear', ticks: { color: c.muted, callback: (v: number | string) => fx(Number(v)) }, grid: { color: c.grid } },
        y: scales.y,
      },
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { label: (t: TooltipItem<'scatter'>) => ` ${fx(t.parsed.x)}, ${fmt(t.parsed.y)}` } } },
    },
  };
}

function config(c: ChartColors): ChartConfiguration {
  // Each builder is typed for its kind; Chart takes the union.
  const built = props.kind === 'line' ? lineConfig(c) : props.kind === 'bar' ? barConfig(c) : props.kind === 'doughnut' ? doughnutConfig(c) : scatterConfig(c);
  return built as ChartConfiguration;
}

function draw(): void {
  if (!canvas.value) return;
  chart?.destroy();
  chart = new Chart(canvas.value, config(colors.value));
}

onMounted(draw);
watch(() => [props.labels, props.series, props.points, props.box, props.kind, colors.value], draw, { deep: true });
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <div class="chart" :style="{ height: `${height}px` }">
    <canvas ref="canvas" role="img" :aria-label="label" />
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
}
</style>
