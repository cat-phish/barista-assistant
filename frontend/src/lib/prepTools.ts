// Prep tools and brew problems on the brew checklists (docs/api/prep-tools.md
// §3d, docs/api/brew-problems.md §6b). Unit-tested in prepTools.test.ts.
import type { BrewProblem, MethodKind, PrepTool } from '../api/types';
import { METHOD_KINDS, METHOD_ORDER } from './equipment';

// What a brew is made with: its recipe's method and brewer, both null without
// a recipe (every item is offered then).
export interface BrewMethod {
  kind: MethodKind | null;
  brewerId: string | null;
}

// A checklist for a brew, in the list's order: the active items offered for
// it, plus any the brew already has, even if since archived or no longer
// offered for it.
function checklist<T extends { id: string; archivedAt: string | null }>(items: readonly T[], selected: readonly string[], offered: (item: T) => boolean): T[] {
  return items.filter((t) => selected.includes(t.id) || (!t.archivedAt && offered(t)));
}

// A prep tool or brew problem is offered for every brew when it names no
// methods or brewers, else for brews of those methods and with those brewers.
type Offered = Pick<PrepTool, 'methodKinds' | 'brewerIds'>;
export function offeredFor(tool: Offered, brew: BrewMethod): boolean {
  if (brew.kind === null) return true;
  if (!tool.methodKinds.length && !tool.brewerIds.length) return true;
  return tool.methodKinds.includes(brew.kind) || (brew.brewerId !== null && tool.brewerIds.includes(brew.brewerId));
}
export function toolsFor<T extends Offered & Pick<PrepTool, 'id' | 'archivedAt'>>(tools: readonly T[], brew: BrewMethod, selected: readonly string[]): T[] {
  return checklist(tools, selected, (t) => offeredFor(t, brew));
}

// A recipe's default prep (docs/api/recipes.md §5 prepToolIds) to tick on
// brew setup: the active ones still offered for its brewer, in list order.
export function recipePrep<T extends Offered & Pick<PrepTool, 'id' | 'archivedAt'>>(
  tools: readonly T[],
  recipe: { prepToolIds: readonly string[]; brewer: { id: string; kind: MethodKind } },
): string[] {
  return toolsFor(tools, { kind: recipe.brewer.kind, brewerId: recipe.brewer.id }, [])
    .filter((t) => recipe.prepToolIds.includes(t.id))
    .map((t) => t.id);
}

// Brew problems (docs/api/brew-problems.md §6b), offered the same way.
export function problemsFor<T extends Offered & Pick<BrewProblem, 'id' | 'archivedAt'>>(problems: readonly T[], brew: BrewMethod, selected: readonly string[]): T[] {
  return checklist(problems, selected, (p) => offeredFor(p, brew));
}

// The editors' check before saving (components/OfferedFor.vue): some method
// or brewer, unless it's offered for every brew.
export function offeredError(everyBrew: boolean, methodKinds: readonly string[], brewerIds: readonly string[]): string {
  return !everyBrew && !methodKinds.length && !brewerIds.length ? 'Pick a method or brewer, or Every brew.' : '';
}

// "Every brew", or its methods then its brewers: "Espresso, Oxo Rapid Brewer".
// Brewers not in the list (gone) are left out.
export function offeredLabel(tool: Offered, brewers: ReadonlyArray<{ id: string; name: string }>): string {
  const methods = METHOD_ORDER.filter((k) => tool.methodKinds.includes(k)).map((k) => METHOD_KINDS[k].label);
  const named = brewers.filter((b) => tool.brewerIds.includes(b.id)).map((b) => b.name);
  return [...methods, ...named].join(', ') || 'Every brew';
}
