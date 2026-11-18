// Your Year in Coffee's shareable image (docs/api/recaps.md §11c, "Sharing"):
// the summary card drawn story-size (1080×1920) and handed to the share
// sheet, or downloaded where files can't be shared. drawYearCard draws on
// any 2D context, so a video (backlog 68) can draw the same card per frame.
import { canvasPng, chartFileName } from './chartImage';
import type { SummaryLine } from './yearSlides';

export const STORY = { width: 1080, height: 1920 } as const;

export interface YearCard {
  kicker: string; // "Your 2025 in coffee"
  value: string; // "312 brews"
  lines: SummaryLine[];
  footer: string; // the app's name, and the bar's on its year
}

export interface CardColors {
  background: string;
  tint: string; // the top of the gradient
  text: string;
  muted: string;
  brand: string;
  font: string; // a CSS font family
}

interface Measure {
  measureText(text: string): { width: number };
}

// The longest start of `text` that fits, with "…" when cut.
export function fitText(ctx: Measure, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 0 && ctx.measureText(`${text.slice(0, cut).trimEnd()}…`).width > maxWidth) cut--;
  return cut > 0 ? `${text.slice(0, cut).trimEnd()}…` : '';
}

// Where things go, in canvas pixels, for `rows` summary lines: the rows
// share what's left between the figure and the footer, up to 150px each.
export function cardLayout(rows: number, width: number = STORY.width, height: number = STORY.height) {
  const s = width / STORY.width;
  const pad = Math.round(96 * s);
  const kickerY = Math.round(300 * s);
  const valueY = kickerY + Math.round(90 * s);
  const listTop = valueY + Math.round(260 * s);
  const footerY = height - Math.round(140 * s);
  const room = footerY - Math.round(80 * s) - listTop;
  const rowH = rows > 0 ? Math.min(Math.round(150 * s), Math.floor(room / rows)) : 0;
  return { s, pad, kickerY, valueY, listTop, rowH, footerY };
}

export function drawYearCard(
  ctx: CanvasRenderingContext2D,
  card: YearCard,
  colors: CardColors,
  width: number = STORY.width,
  height: number = STORY.height,
): void {
  const box = cardLayout(card.lines.length, width, height);
  const px = (n: number) => Math.round(n * box.s);
  const font = (weight: number, size: number) => `${weight} ${px(size)}px ${colors.font}`;
  const inner = width - box.pad * 2;

  const bg = ctx.createLinearGradient(0, 0, width * 0.4, height);
  bg.addColorStop(0, colors.tint || colors.background);
  bg.addColorStop(0.6, colors.background);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  ctx.fillStyle = colors.muted;
  ctx.font = font(600, 52);
  ctx.fillText(fitText(ctx, card.kicker, inner), box.pad, box.kickerY);
  ctx.fillStyle = colors.brand;
  ctx.font = font(800, 150);
  ctx.fillText(fitText(ctx, card.value, inner), box.pad, box.valueY + px(150));

  // A rule, then one row per line: the name on the left, the figure (and
  // its change on last year) on the right.
  ctx.fillStyle = colors.muted;
  ctx.globalAlpha = 0.3;
  ctx.fillRect(box.pad, box.listTop - px(40), inner, Math.max(1, px(3)));
  ctx.globalAlpha = 1;
  const rowFont = Math.min(48, Math.round((box.rowH / box.s) * 0.34));
  card.lines.forEach((line, i) => {
    const y = box.listTop + i * box.rowH + Math.round(box.rowH * 0.6);
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.muted;
    ctx.font = font(500, rowFont);
    const name = fitText(ctx, line.name, inner * 0.4);
    const nameW = ctx.measureText(name).width;
    ctx.textAlign = 'right';
    let right = width - box.pad;
    if (line.change) {
      ctx.font = font(600, rowFont * 0.7);
      ctx.fillStyle = line.change.dir === 'up' ? colors.brand : colors.muted;
      ctx.fillText(line.change.text, right, y);
      right -= ctx.measureText(line.change.text).width + px(20);
    }
    ctx.fillStyle = colors.text;
    ctx.font = font(700, rowFont);
    ctx.fillText(fitText(ctx, line.detail, right - box.pad - nameW - px(40)), right, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.muted;
    ctx.font = font(500, rowFont);
    ctx.fillText(name, box.pad, y);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = colors.muted;
  ctx.font = font(600, 36);
  ctx.fillText(fitText(ctx, card.footer, inner), width / 2, box.footerY);
}

// The page's colours and font, read where the card is drawn.
export function readCardColors(): CardColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--bg', '#fff'),
    tint: v('--brand-tint', ''),
    text: v('--text', '#000'),
    muted: v('--text-muted', '#555'),
    brand: v('--brand', '#000'),
    font: getComputedStyle(document.body).fontFamily || 'sans-serif',
  };
}

export function yearCardPng(card: YearCard, colors: CardColors): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = STORY.width;
  canvas.height = STORY.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('No canvas'));
  drawYearCard(ctx, card, colors);
  return canvasPng(canvas);
}

// "Your 2025 in coffee" → your-2025-in-coffee.png.
export const yearImageName = (card: YearCard) => chartFileName(card.kicker);

export type ShareResult = 'shared' | 'saved' | 'cancelled';

// The share sheet where it takes files (most phones), else a download.
// Closing the sheet isn't an error.
// Whether this browser's share sheet takes image files; without it Share
// would only download, so the slides offer Save image alone.
export function canShareImages(): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false;
  return navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] });
}

export async function shareImage(blob: Blob, fileName: string, title: string, save: (name: string, blob: Blob) => void): Promise<ShareResult> {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Refused (no user activation left, say): save it instead.
    }
  }
  save(fileName, blob);
  return 'saved';
}
