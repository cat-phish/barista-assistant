// Brew setup from last time (Settings → Brew setup, docs/api/auth.md §1
// rememberSetup): what the brew page fills in from the last brew on this
// device. Which ones is the person's preference; the values themselves stay
// in this device's storage, per workspace (BrewView recall / remember).
import type { MethodKind, RememberKey } from '../api/types';
import type { Size } from './servings';

// In the order the brew page asks. The defaults are the backend's
// (DEFAULT_PREFERENCES).
export const REMEMBER_OPTIONS: Array<{ key: RememberKey; label: string; hint?: string }> = [
  { key: 'what', label: 'What you’re making', hint: 'Off: the first in the list' },
  { key: 'brewer', label: 'Brewer, for each method', hint: 'Off: the drink’s default, or the first' },
  { key: 'recipe', label: 'Recipe, for each brewer', hint: 'Off: the drink’s default, or the first' },
  { key: 'bean', label: 'Bean', hint: 'Off: pick one each time' },
  { key: 'grinder', label: 'Grinder', hint: 'Off: the recipe’s default grinder' },
  { key: 'grind', label: 'Grind setting and speed', hint: 'Your last with that grinder and recipe. Off: the AI suggestion, if any' },
  { key: 'waterProfile', label: 'Water profile', hint: 'Off: your default water' },
  { key: 'prepTools', label: 'Prep checklist, for each brewer', hint: 'Off: nothing ticked' },
  { key: 'size', label: 'Drink size, for each drink', hint: 'Off: the drink’s default size' },
];

// What the brew page keeps in storage, and the setting each one follows
// (null: always remembered, like the Suggest parameters choices).
export type Remembered =
  | 'brewWhat'
  | 'brewItem'
  | `brewBrewer.${MethodKind}`
  | `brewRecipe.${string}` // per brewer id
  | 'beanId'
  | 'grinderId'
  | 'waterProfileId'
  | `prepTools.${string}` // per brewer id ('none' without one)
  | `size.${string}` // per drink id
  | 'compareWith'
  | 'suggestSource' // read only: compareWith before bags (lib/suggest.ts rememberedSource)
  | 'suggestMax'
  | 'suggestAlternatives';
export function rememberKeyFor(slot: Remembered): RememberKey | null {
  if (slot === 'brewWhat' || slot === 'brewItem') return 'what';
  if (slot.startsWith('brewBrewer.')) return 'brewer';
  if (slot.startsWith('brewRecipe.')) return 'recipe';
  if (slot === 'beanId') return 'bean';
  if (slot === 'grinderId') return 'grinder';
  if (slot === 'waterProfileId') return 'waterProfile';
  if (slot.startsWith('prepTools.')) return 'prepTools';
  if (slot.startsWith('size.')) return 'size';
  return null;
}

// A remembered id, if it's still one to pick (not archived or gone).
export function stillActive(id: string | null, list: ReadonlyArray<{ id: string; archivedAt: string | null }>): string | null {
  return id && list.some((x) => x.id === id && !x.archivedAt) ? id : null;
}

// Prep tools: stored as "id,id", or "none" when nothing was ticked (an empty
// value isn't stored). Archived ones are dropped.
export const storedTools = (ids: readonly string[]): string => ids.join(',') || 'none';
export function rememberedTools(saved: string | null, tools: ReadonlyArray<{ id: string; archivedAt: string | null }>): string[] | null {
  if (saved === null) return null;
  return saved.split(',').filter((id) => stillActive(id, tools) !== null);
}

// Drink size: stored as "12|fl_oz".
export const storedSize = (s: Size): string => `${s.size}|${s.unit}`;
export function rememberedSize(saved: string | null): Size | null {
  const [n, unit] = (saved ?? '').split('|');
  const size = Number(n);
  return (unit === 'fl_oz' || unit === 'ml') && size > 0 && size <= 2000 ? { size, unit } : null;
}
