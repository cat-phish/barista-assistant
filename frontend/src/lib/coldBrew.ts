// Cold styles (docs/api/recipes.md §5, recipe-styles.md §5e), by what a
// style brews like. Long ones steep or drip for hours: Start steep, then
// Finish later, with steps as a checklist instead of a timer. Rapid cold (an
// OXO Rapid Brewer) runs the timer in minutes. All of them can be served
// diluted. The backend has the same lists (LONG_STYLES, COLD_STYLES).
import type { DilutionWith, RecipeStyle, SteepTemp } from '../api/types';

const LONG: readonly RecipeStyle[] = ['cold_brew', 'kyoto_drip'];
const COLD: readonly RecipeStyle[] = ['cold_brew', 'kyoto_drip', 'rapid_cold'];

export const isLongStyle = (brewsLike: RecipeStyle | null | undefined): boolean => !!brewsLike && LONG.includes(brewsLike);
export const isColdStyle = (brewsLike: RecipeStyle | null | undefined): boolean => !!brewsLike && COLD.includes(brewsLike);

export const STEEP_TEMPS: Record<SteepTemp, string> = { fridge: 'Fridge', room: 'Room temperature' };
export const DILUTION_WITH: Record<DilutionWith, string> = { water: 'water', milk: 'milk', ice: 'ice', other: 'something else' };

// "12–18 h", "12 h", or '' without a window.
export function steepWindowText(min: number | null, max: number | null): string {
  if (min === null || max === null) return '';
  const h = (n: number) => `${Number(n.toFixed(1))}`;
  return min === max ? `${h(min)} h` : `${h(min)}–${h(max)} h`;
}

// "1 : 1 with water", or '' without a dilution.
export function dilutionText(ratio: number | null, withWhat: DilutionWith | null): string {
  if (ratio === null) return '';
  return `1 : ${Number(ratio.toFixed(1))}${withWhat ? ` with ${DILUTION_WITH[withWhat]}` : ''}`;
}
