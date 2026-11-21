// A grinder's starting points and the methods it can't do
// (docs/api/grinders.md §3b, "Starting points").
import type { Grinder, GrinderStartingPoint, MethodKind, RecipeStyle } from '../api/types';
import { METHOD_KINDS, METHOD_ORDER, RECIPE_STYLES, STYLES_BY_KIND } from './equipment';

type StartFields = Pick<Grinder, 'startingSetting' | 'startingPoints'>;

// What a recipe's grind on this grinder starts at: the row for the recipe's
// style, else the row for its method, else the grinder's general one.
export function grinderStartingPoint(g: StartFields, kind: MethodKind | null, style: RecipeStyle | null): { setting: number; point: GrinderStartingPoint | null } | null {
  const rows = g.startingPoints ?? [];
  const point = (kind && style && rows.find((p) => p.method === kind && p.style === style)) || (kind && rows.find((p) => p.method === kind && p.style === null)) || null;
  if (point) return { setting: point.setting, point };
  return g.startingSetting === null ? null : { setting: g.startingSetting, point: null };
}

// Whether it can grind for a method. No method yet = no limit.
export function grinderCanDo(g: Pick<Grinder, 'unavailableMethods'>, kind: MethodKind | null | undefined): boolean {
  return !kind || !(g.unavailableMethods ?? []).includes(kind);
}

// The grinders a picker offers for a method: active ones that can do it, plus
// the one already chosen (an archived or unsuitable grinder stays on what
// uses it).
export function grinderChoices<G extends Pick<Grinder, 'id' | 'archivedAt' | 'unavailableMethods'>>(grinders: G[], kind: MethodKind | null | undefined, keepId?: string | null): G[] {
  return grinders.filter((g) => g.id === keepId || (g.archivedAt === null && grinderCanDo(g, kind)));
}

// Starting-point targets for the grinder form, as select values:
// "espresso" (every espresso style) or "filter/cold_brew".
export interface StartTarget {
  key: string;
  method: MethodKind;
  style: RecipeStyle | null;
  label: string;
}
export const startKey = (method: MethodKind, style: RecipeStyle | null): string => (style ? `${method}/${style}` : method);
export const START_TARGETS: Array<{ method: MethodKind; label: string; targets: StartTarget[] }> = METHOD_ORDER.map((method) => ({
  method,
  label: METHOD_KINDS[method].label,
  targets: [
    { key: startKey(method, null), method, style: null, label: `${METHOD_KINDS[method].label} (all styles)` },
    ...STYLES_BY_KIND[method]
      .filter((s) => s !== 'other')
      .map((style) => ({ key: startKey(method, style), method, style, label: `${METHOD_KINDS[method].label} · ${RECIPE_STYLES[style]}` })),
  ],
}));
export const startTarget = (key: string): StartTarget | undefined => START_TARGETS.flatMap((m) => m.targets).find((t) => t.key === key);

// "espresso", "cold brew": what a starting point is for, in a sentence.
export function startPointLabel(p: GrinderStartingPoint | null): string {
  if (!p) return 'every method';
  return (p.style ? RECIPE_STYLES[p.style] : METHOD_KINDS[p.method].label).toLowerCase();
}
