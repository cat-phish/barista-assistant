// Repeat a brew (docs/features.md, Brewing): brew setup filled in from an
// earlier brew log. This works out the setup choices; BrewView applies them
// and fills dose, water, size, temperature and grind from the log itself.
// What's no longer available (archived or deleted) is skipped and named.
import type { Bean, BrewLog, Brewer, Drink, Grinder, Recipe, WaterProfile } from '../api/types';
import { batchSuffix } from './beans';
import { encodeCategory, encodeDrink, encodeMethod, encodePlain, methodKey, NO_RECIPE } from './brewChoice';
import { formatAdded } from './format';

export interface RepeatPlan {
  beanId: string; // '' = pick one (see missing)
  what: string; // encodeMethod / encodeCategory / NO_RECIPE
  item: string; // encodePlain / encodeDrink, '' without a recipe
  brewerId: string;
  recipeId: string;
  grinderId: string; // '' = none
  waterProfileId: string | null; // null = keep setup's (the default)
  missing: string[]; // what couldn't be filled, one sentence each
}

export interface RepeatSources {
  beans: Bean[]; // active ones (what can be brewed)
  brewers: Brewer[];
  drinks: Drink[];
  recipes: Recipe[];
  grinders: Grinder[];
  waterProfiles: WaterProfile[];
}

const sameCoffee = (a: Pick<Bean, 'roasterName' | 'beanName'>, b: Pick<Bean, 'roasterName' | 'beanName'>) =>
  a.roasterName.trim().toLowerCase() === b.roasterName.trim().toLowerCase() && a.beanName.trim().toLowerCase() === b.beanName.trim().toLowerCase();

// The log's bean if it can still be brewed; else the newest active bean of
// the same coffee (the next bag or batch).
function repeatBean(log: BrewLog, beans: Bean[]): { id: string; note: string | null } {
  if (beans.some((b) => b.id === log.beanId)) return { id: log.beanId, note: null };
  const name = `${log.bean.roasterName} ${log.bean.beanName}${batchSuffix(log.bean)}`;
  const next = beans.filter((b) => sameCoffee(b, log.bean)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (next) return { id: next.id, note: `${name} is archived, so the newest bag of it${next.batchNumber ? ` (Batch ${next.batchNumber})` : ''} was picked.` };
  return { id: '', note: `${name} is archived and there's no other bag of it: pick a bean.` };
}

export function repeatPlan(log: BrewLog, s: RepeatSources): RepeatPlan {
  const missing: string[] = [];
  const bean = repeatBean(log, s.beans);
  if (bean.note) missing.push(bean.note);

  const brewer = s.brewers.find((b) => b.id === log.brewerId && !b.archivedAt) ?? null;
  if (log.brewer && !brewer) missing.push(`The brewer ${log.brewer.name} is archived, so the recipe wasn't filled.`);
  const drink = log.drinkId ? (s.drinks.find((d) => d.id === log.drinkId && !d.archivedAt) ?? null) : null;
  if (log.drink && !drink) missing.push(`${log.drink.name} is archived or deleted, so it's brewed as a plain brew.`);
  const recipe = brewer && log.recipeId ? (s.recipes.find((r) => r.id === log.recipeId && !r.archivedAt && r.brewer.id === brewer.id) ?? null) : null;
  if (brewer && log.recipe && !recipe) missing.push(`The recipe ${log.recipe.name} is archived or moved, so another of ${brewer.name}'s recipes was picked.`);

  let what = NO_RECIPE;
  let item = '';
  if (brewer && drink && drink.kind === brewer.kind) {
    what = encodeCategory(drink.category?.id ?? null);
    item = encodeDrink(drink.id);
  } else if (brewer) {
    what = encodeMethod(methodKey(brewer));
    item = encodePlain(methodKey(brewer));
  }

  const grinder = log.grinderId ? s.grinders.find((g) => g.id === log.grinderId && !g.archivedAt) : undefined;
  if (log.grinder && !grinder) missing.push(`The grinder ${log.grinder.name} is archived, so the grind wasn't filled.`);
  const water = log.waterProfileId ? s.waterProfiles.find((w) => w.id === log.waterProfileId && !w.archivedAt) : undefined;
  if (log.waterProfile && !water) missing.push(`The water ${log.waterProfile.name} is archived.`);

  return {
    beanId: bean.id,
    what,
    item,
    brewerId: brewer?.id ?? '',
    recipeId: recipe?.id ?? '',
    grinderId: grinder?.id ?? '',
    waterProfileId: water?.id ?? null,
    missing,
  };
}

// What a brew made, for grouping the quick repeat buttons: a drink, or a
// plain brew of the brewer's method (a Latte and a straight shot differ).
export function madeKey(log: BrewLog, brewers: Brewer[]): string {
  if (log.drinkId) return `drink:${log.drinkId}`;
  const brewer = brewers.find((b) => b.id === log.brewerId);
  if (brewer) return `plain:${methodKey(brewer)}`;
  return log.brewer ? `plain:${log.brewer.kind}` : NO_RECIPE;
}

// The newest brew of each of the last n different things made, newest first.
// logs: newest first, as the API lists them.
export function recentByMade(logs: BrewLog[], brewers: Brewer[], n = 3): BrewLog[] {
  const seen = new Set<string>();
  const out: BrewLog[] = [];
  for (const log of logs) {
    const key = madeKey(log, brewers);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(log);
    if (out.length === n) break;
  }
  return out;
}

// "The Atlas" / "V60" / "No recipe", its recipe ("House V60", or null),
// "Guji · Batch 3", "Oct 21".
export function repeatLabel(log: BrewLog, now: Date = new Date()): { made: string; recipe: string | null; bean: string; when: string } {
  return {
    made: log.drink?.name ?? log.brewer?.name ?? 'No recipe',
    recipe: log.recipe?.name ?? null,
    bean: `${log.bean.beanName}${batchSuffix(log.bean)}`,
    when: formatAdded(log.timestamp, now),
  };
}
