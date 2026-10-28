// Field visibility (docs/api/workspaces.md §2, "Field visibility"): the
// optional fields of the brew, bean and recipe forms that a workspace can
// hide (Settings → Fields). Required fields aren't listed, so they can't be.
// Every new optional field on these forms gets an entry here.

export type FieldForm = 'brew' | 'bean' | 'recipe';

export interface FieldInfo {
  key: string; // `${form}.${name}`, stored in settings.hiddenFields
  form: FieldForm;
  label: string;
  hint?: string;
}

const brew = (name: string, label: string, hint?: string): FieldInfo => ({ key: `brew.${name}`, form: 'brew', label, hint });
const bean = (name: string, label: string, hint?: string): FieldInfo => ({ key: `bean.${name}`, form: 'bean', label, hint });
const recipe = (name: string, label: string, hint?: string): FieldInfo => ({ key: `recipe.${name}`, form: 'recipe', label, hint });

// In the order the forms show them.
export const FIELDS = [
  brew('ice', 'Ice (flash chilled)', 'Ice in the server the hot water is brewed onto'),
  brew('yield', 'Yield', 'The weighed brewed coffee (filter; a shot always records its weight)'),
  brew('tds', 'TDS and Brix', 'Refractometer reading and the extraction worked out from it'),
  brew('temp', 'Water temperature'),
  brew('grinder', 'Grinder'),
  brew('grind', 'Grind setting'),
  brew('rpm', 'Grind speed (RPM)', 'Only asked for on variable-speed grinders'),
  brew('grinderWeights', 'Beans in / grounds out', 'Grinder retention'),
  brew('waterProfile', 'Water profile'),
  brew('prepTools', 'Prep checklist'),
  brew('problems', 'Problems checklist', 'What went wrong while brewing (Settings → Lists)'),
  brew('steepTemp', 'Steep in fridge or room (cold styles)'),
  brew('dilution', 'Dilution served (cold styles, concentrates)'),
  brew('window', 'Steep or finish time (cold styles)', 'Change the recipe’s for one brew, before it starts. Hidden: the recipe’s is used'),
  brew('firstDrop', 'First drop (espresso)', 'The box in the log; the timer keeps its button, which first-drop steps need'),

  bean('process', 'Process'),
  bean('blendType', 'Type', 'Single origin or blend'),
  bean('origin', 'Growing area and country'),
  bean('region', 'Region'),
  bean('producer', 'Producer'),
  bean('altitude', 'Altitude'),
  bean('flavorProfile', 'Flavor profile'),
  bean('decaf', 'Decaf'),
  bean('roastType', 'Roasted for'),
  bean('roastDate', 'Roast date'),
  bean('roastLevel', 'Roast level'),
  bean('batchNumber', 'Batch no.'),
  bean('price', 'Bag price'),
  bean('bagWeight', 'Bag weight'),
  bean('purchaseDate', 'Purchase date'),
  bean('greenSupplier', 'Green bean supplier'),
  bean('website', 'Website'),
  bean('rating', 'Rating'),
  bean('notes', 'Notes'),

  recipe('style', 'Style'),
  recipe('ice', 'Flash chilled and its ice', 'The checkbox, and the ice in the server the hot water is brewed onto; the ratio counts it'),
  recipe('expectedYield', 'Expected yield (filter)'),
  recipe('temp', 'Water temperature'),
  recipe('prepTools', 'Default prep', 'Prep ticked when the recipe is brewed'),
  recipe('steepWindow', 'Steep time (cold brew, Kyoto drip)', 'In hours; sets when the ready reminder comes'),
  recipe('steepTemp', 'Steep in fridge or room (cold brew, Kyoto drip)'),
  recipe('dilution', 'Serving dilution (cold styles, concentrates)', 'A concentrate is any filter recipe served diluted, e.g. poured over ice'),
  recipe('finishWindow', 'Target finish / shot time'),
  recipe('firstDropWindow', 'First drop window (espresso)'),
  recipe('defaultGrinder', 'Default grinder'),
  recipe('grindSettings', 'Grind starting points'),
  recipe('flowUnit', 'Flow unit (espresso)'),
  recipe('stepTemp', 'Step temperatures'),
] as const satisfies readonly FieldInfo[];

export type FieldKey = (typeof FIELDS)[number]['key'];

export const FIELD_FORMS: Record<FieldForm, string> = { brew: 'Brews', bean: 'Beans', recipe: 'Recipes' };

export function fieldsFor(form: FieldForm): FieldInfo[] {
  return FIELDS.filter((f) => f.form === form);
}

// Whether a form value counts as recorded: a hidden field that has one when
// the form opens stays shown, so nothing recorded is invisible while editing.
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// Shown unless hidden; a hidden one is shown when it was revealed (had a value).
export function isShown(key: FieldKey, hidden: ReadonlySet<string>, revealed: ReadonlySet<string>): boolean {
  return !hidden.has(key) || revealed.has(key);
}
