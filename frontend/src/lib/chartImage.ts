// A chart card's Copy button (ChartCard.vue): the chart as a PNG with its
// title drawn on and a solid background (the Chart.js canvas is transparent
// and has no title), or, while the card shows its table, the rows as
// tab-separated text that pastes into a spreadsheet.

export interface ChartTable {
  head: string[];
  rows: Array<Array<string | number>>;
}

// One cell: a tab or line break inside it would split the row.
function cell(value: string | number): string {
  return String(value).replace(/[\t\r\n]+/g, ' ');
}

export function tableText(table: ChartTable): string {
  return [table.head, ...table.rows].map((row) => row.map(cell).join('\t')).join('\n');
}

// "Beans by country" → beans-by-country.png, for the download fallback.
export function chartFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'chart'}.png`;
}

export interface TitledLayout {
  width: number;
  height: number;
  pad: number;
  fontPx: number;
  chartTop: number; // where the chart is drawn, below the title
}

// Sizes in canvas pixels. `scale` is canvas pixels per CSS pixel (Chart.js
// draws at the device pixel ratio), so the title matches the card's 1rem h2.
export function titledLayout(chartWidth: number, chartHeight: number, scale: number): TitledLayout {
  const s = scale > 0 ? scale : 1;
  const pad = Math.round(16 * s);
  const fontPx = Math.round(16 * s);
  const chartTop = pad + Math.round(fontPx * 1.25) + Math.round(8 * s);
  return { width: chartWidth + pad * 2, height: chartTop + chartHeight + pad, pad, fontPx, chartTop };
}

export interface ImageColors {
  surface: string;
  text: string;
}

export function chartPng(chart: HTMLCanvasElement, title: string, colors: ImageColors): Promise<Blob> {
  const scale = chart.clientWidth ? chart.width / chart.clientWidth : window.devicePixelRatio || 1;
  const box = titledLayout(chart.width, chart.height, scale);
  const out = document.createElement('canvas');
  out.width = box.width;
  out.height = box.height;
  const ctx = out.getContext('2d');
  if (!ctx) return Promise.reject(new Error('No canvas'));
  ctx.fillStyle = colors.surface || '#fff';
  ctx.fillRect(0, 0, box.width, box.height);
  ctx.fillStyle = colors.text || '#000';
  ctx.font = `600 ${box.fontPx}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillText(title, box.pad, box.pad, box.width - box.pad * 2);
  ctx.drawImage(chart, box.pad, box.chartTop);
  return new Promise((resolve, reject) =>
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No image'))), 'image/png'),
  );
}
