// What a delete would take with it, as warning lines for the delete dialog
// (docs/api/README.md, "Archiving and deleting"). Unit-tested in deleting.test.ts.

export type Usage = Record<string, number>;
export type DeletableKind = 'brewer' | 'grinder' | 'water' | 'tool' | 'recipe' | 'drink' | 'ingredient' | 'process' | 'style' | 'method' | 'problem';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const be = (n: number) => (n === 1 ? 'is' : 'are');

// Each kind's counts, in the order to show them; zero counts are left out.
const WARNINGS: Record<DeletableKind, Record<string, (n: number) => string>> = {
  brewer: {
    recipeCount: (n) => `Its ${plural(n, 'recipe')} will be deleted too.`,
    brewLogCount: (n) => `${plural(n, 'brew')} will lose their brewer and recipe. Everything else in them stays.`,
    menuItemCount: (n) => `It will be taken off the public menu (${plural(n, 'item')}).`,
  },
  grinder: {
    brewLogCount: (n) => `${plural(n, 'brew')} will lose their grinder; the grind setting stays as text.`,
    recipeCount: (n) => `${plural(n, 'recipe')} will lose their grind starting point for it.`,
  },
  water: { brewLogCount: (n) => `${plural(n, 'brew')} will lose their water profile.` },
  tool: {
    brewLogCount: (n) => `${plural(n, 'brew')} will no longer list this tool.`,
    recipeCount: (n) => `${plural(n, 'recipe')} will no longer start with it ticked.`,
  },
  problem: { brewLogCount: (n) => `${plural(n, 'brew')} will no longer list this problem.` },
  recipe: {
    brewLogCount: (n) => `${plural(n, 'brew')} will lose their recipe. Everything else in them stays.`,
    drinkCount: (n) => `${plural(n, 'drink')} will lose it as their default recipe.`,
  },
  drink: {
    brewLogCount: (n) => `${plural(n, 'brew')} will no longer say which drink they were for.`,
    variantCount: (n) => `Its ${plural(n, 'variant')} ${be(n)} kept and move up a level.`,
    menuItemCount: (n) => `It will be taken off the public menu (${plural(n, 'item')}).`,
  },
  ingredient: { drinkCount: (n) => `It will be removed from ${plural(n, 'drink')}.` },
  process: { beanCount: (n) => `${plural(n, 'bean')} will lose their process.` },
  style: { recipeCount: (n) => `${plural(n, 'recipe')} will lose their style.` },
  method: { brewerCount: (n) => `${plural(n, 'brewer')} will move to the built-in method it works like. Their recipes and brews don't change.` },
};

export function usageWarnings(kind: DeletableKind, usage: Usage): string[] {
  return Object.entries(WARNINGS[kind]).flatMap(([key, line]) => ((usage[key] ?? 0) > 0 ? [line(usage[key]!)] : []));
}
