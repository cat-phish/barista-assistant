// Reading a backup file before restoring it (docs/api/backup.md §2b), and
// saving one. Unit-tested in backup.test.ts.
import { LISTS, type BackupFile, type ListName } from '../api/backup';

// What the preview counts, by the file's table names.
const COUNTED: Array<[table: string, one: string, many: string]> = [
  ['brew_logs', 'brew', 'brews'],
  ['beans', 'bean', 'beans'],
  ['recipes', 'recipe', 'recipes'],
  ['drinks', 'drink', 'drinks'],
  ['ingredients', 'ingredient', 'ingredients'],
  ['brewers', 'brewer', 'brewers'],
  ['grinders', 'grinder', 'grinders'],
  ['water_profiles', 'water profile', 'water profiles'],
  ['menu_items', 'menu item', 'menu items'],
];

export type ReadBackup = { ok: true; file: BackupFile } | { ok: false; error: string };

export function readBackup(text: string): ReadBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't a backup (it isn't JSON)." };
  }
  const file = data as Partial<BackupFile> | null;
  if (!file || file.format !== 'barista-backup' || typeof file.tables !== 'object' || !file.workspace) {
    return { ok: false, error: "That file isn't a Barista backup." };
  }
  return { ok: true, file: file as BackupFile };
}

// The lists a file can import (docs/api/backup.md §2b, "By list"): an export
// says which it was made for; a backup has every list it has rows of.
export function fileLists(file: BackupFile): ListName[] {
  if (file.scope === 'lists' && file.lists) return LISTS.filter((l) => file.lists!.includes(l));
  return LISTS.filter((l) => (file.tables[l]?.length ?? 0) > 0);
}

// Lists whose export carries AI suggestions: a brew's analyses, a bean's
// suggested parameters (and a brew brings its bean). What each was sent to
// the AI is left out unless asked (docs/api/backup.md §2b).
export const hasAiSuggestions = (lists: readonly ListName[]): boolean => lists.some((l) => l === 'brew_logs' || l === 'beans');

// What a list's items bring along when imported, if anything
// (docs/api/backup.md §2b, "What comes along").
export const COMES_ALONG: Record<ListName, string | null> = {
  beans: 'each bean’s process',
  recipes: 'each recipe’s brewer and its method, style, grinders and prep items',
  drinks: 'each drink’s category, recipe (with its brewer and grinders) and ingredients',
  ingredients: null,
  brewers: 'each brewer’s method',
  grinders: null,
  water_profiles: null,
  prep_tools: 'the brewers each is offered for, with their methods',
  brew_problems: null,
  brew_logs: 'each brew’s bean, recipe, grinder, water, drink, prep items and problems',
};

// The "add as a copy" example, from the file's own items: "Test Bean (2)"
// (a copy's bean name or name gets the number; brews are never copied).
export function copyExample(file: BackupFile, lists: readonly ListName[]): string {
  for (const list of lists) {
    if (list === 'brew_logs') continue;
    const first = file.tables[list]?.[0] as Record<string, unknown> | undefined;
    const name = first?.[list === 'beans' ? 'beanName' : 'name'];
    if (typeof name === 'string' && name) return `${name} (2)`;
  }
  return 'Name (2)';
}

// Why a list page's Import… can't use this file, or null when it can.
export function missingListError(file: BackupFile, list: ListName): string | null {
  const has = fileLists(file);
  if (has.includes(list)) return null;
  const others = has.map((l) => LIST_LABELS[l].toLowerCase()).join(', ');
  return `This file has no ${LIST_LABELS[list].toLowerCase()}${others ? ` (it has ${others}); import it from Settings → Data` : ''}.`;
}

// "12 brews · 3 beans · 2 recipes", leaving out what the file has none of.
export function backupSummary(file: BackupFile): string {
  return COUNTED.flatMap(([table, one, many]) => {
    const n = file.tables[table]?.length ?? 0;
    return n ? [`${n} ${n === 1 ? one : many}`] : [];
  }).join(' · ');
}

export const backupFileName = (file: BackupFile): string => `${file.workspace.slug}-backup-${file.exportedAt.slice(0, 10)}.json`;
// "home-bar-recipes-drinks-2026-10-23.json"
export const exportFileName = (file: BackupFile, lists: readonly ListName[]): string =>
  `${file.workspace.slug}-${lists.map((l) => l.replace(/_/g, '-')).join('-')}-${file.exportedAt.slice(0, 10)}.json`;

// The lists, and every table an import summary can mention, as people say them.
export const LIST_LABELS: Record<ListName, string> = {
  beans: 'Beans',
  recipes: 'Recipes',
  drinks: 'Drinks',
  ingredients: 'Ingredients',
  brewers: 'Brewers',
  grinders: 'Grinders',
  water_profiles: 'Water profiles',
  prep_tools: 'Prep',
  brew_problems: 'Brew problems',
  brew_logs: 'Journal (brews)',
};
const TABLE_LABELS: Record<string, string> = {
  ...LIST_LABELS,
  brewer_methods: 'Brewer methods',
  bean_processes: 'Bean processes',
  recipe_styles: 'Recipe styles',
  drink_categories: 'Drink categories',
  menu_sections: 'Menu sections',
  bean_freezes: 'freeze periods',
  recipe_steps: 'recipe steps',
  recipe_grind_settings: 'grind starting points',
  recipe_prep_tools: 'recipe prep',
  drink_ingredients: 'drink ingredients',
  menu_items: 'menu items',
  brew_log_marks: 'timer marks',
  prep_tool_brewers: 'prep item brewers',
  brew_log_tools: 'prep ticks',
  brew_log_problems: 'problem ticks',
  llm_analyses: 'AI suggestions',
  parameter_suggestions: 'suggested parameters',
};
export const tableLabel = (table: string): string => TABLE_LABELS[table] ?? table.replace(/_/g, ' ');

// "4 recipe steps · 2 grind starting points"
export const detailsText = (details: Record<string, number>): string =>
  Object.entries(details)
    .map(([table, n]) => `${n} ${tableLabel(table)}`)
    .join(' · ');

// Hands the browser a file to save.
export function saveJson(fileName: string, data: unknown): void {
  saveBlob(fileName, new Blob([JSON.stringify(data)], { type: 'application/json' }));
}
export function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
