// The public menu's accent colour (docs/api/menu.md §7b): how it reads on the
// guest page's light background. Unit-tested in menuBranding.test.ts.

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// WCAG relative luminance of "#rrggbb".
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

// Contrast ratio against white (1–21).
export function contrastOnWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

// Headings are large text: 3:1 is enough (WCAG AA for large text).
export const tooLight = (hex: string): boolean => HEX_COLOR.test(hex) && contrastOnWhite(hex) < 3;
