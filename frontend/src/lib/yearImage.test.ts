import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY, cardLayout, drawYearCard, fitText, shareImage, yearImageName, type YearCard } from './yearImage';

// 10px a character, whatever the font.
const measure = { measureText: (t: string) => ({ width: t.length * 10 }) };

const card: YearCard = {
  kicker: 'Your 2025 in coffee',
  value: '312 brews',
  lines: [
    { name: 'Days brewed', detail: '201', change: { dir: 'up', text: '+5%' } },
    { name: 'Top bean', detail: 'A very long bean name '.repeat(5) },
  ],
  footer: 'Barista-Assistant',
};

describe('fitText', () => {
  it('keeps what fits and cuts the rest with an ellipsis', () => {
    expect(fitText(measure, 'Kenya', 100)).toBe('Kenya');
    expect(fitText(measure, 'Ethiopia Guji', 80)).toBe('Ethiopi…');
    expect(fitText(measure, 'Kenya', 5)).toBe('');
  });
});

describe('cardLayout', () => {
  it('fits every summary line above the footer, at story size and smaller', () => {
    for (const [w, h] of [[STORY.width, STORY.height], [540, 960]] as const) {
      const box = cardLayout(8, w, h);
      expect(box.listTop + 8 * box.rowH).toBeLessThan(box.footerY);
      expect(box.rowH).toBeGreaterThan(0);
    }
    expect(cardLayout(2).rowH).toBe(150);
  });
});

describe('drawYearCard', () => {
  it('draws the kicker, figure, every line and the footer inside the canvas', () => {
    const texts: Array<{ text: string; x: number; y: number }> = [];
    const ctx = {
      ...measure,
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      fillRect: () => undefined,
      fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
    } as unknown as CanvasRenderingContext2D;
    drawYearCard(ctx, card, { background: '#fff', tint: '#fee', text: '#000', muted: '#555', brand: '#a50', font: 'sans-serif' });
    const shown = texts.map((t) => t.text);
    expect(shown).toEqual(expect.arrayContaining(['Your 2025 in coffee', '312 brews', 'Days brewed', '201', '+5%', 'Top bean', 'Barista-Assistant']));
    expect(shown.some((t) => t.startsWith('A very long') && t.endsWith('…'))).toBe(true);
    for (const t of texts) {
      expect(t.y).toBeGreaterThan(0);
      expect(t.y).toBeLessThan(STORY.height);
    }
  });
});

describe('shareImage', () => {
  afterEach(() => vi.unstubAllGlobals());
  const blob = new Blob(['png'], { type: 'image/png' });

  it('hands the file to the share sheet where it takes files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    const save = vi.fn();
    expect(await shareImage(blob, 'your-2025-in-coffee.png', 'Your 2025 in coffee', save)).toBe('shared');
    expect(share.mock.calls[0]![0].files[0].name).toBe('your-2025-in-coffee.png');
    expect(save).not.toHaveBeenCalled();
  });

  it('closing the sheet is no error; a refusal or no sheet downloads it', async () => {
    const save = vi.fn();
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(new DOMException('', 'AbortError')) });
    expect(await shareImage(blob, 'a.png', 'A', save)).toBe('cancelled');
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(new DOMException('', 'NotAllowedError')) });
    expect(await shareImage(blob, 'a.png', 'A', save)).toBe('saved');
    vi.stubGlobal('navigator', {});
    expect(await shareImage(blob, 'a.png', 'A', save)).toBe('saved');
    expect(save).toHaveBeenCalledTimes(2);
  });
});

it('names the file after the card', () => {
  expect(yearImageName(card)).toBe('your-2025-in-coffee.png');
});
