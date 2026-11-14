// Batch add (docs/api/beans.md §4, "Frontend (batch add)"): the Add bean
// form's "Carry over" boxes. The keys match BEAN_CARRY_KEYS in
// @barista/shared/beanCarry (beanCarry.test.ts checks); the workspace's
// beanCarryOver lists the ones that start ticked (Settings → Defaults).
import { nextBatch } from './beans';
import { FIELDS, type FieldKey } from './fields';

export type BeanCarryKey =
  | 'roasterName' | 'beanName' | 'process' | 'blendType' | 'origin' | 'region' | 'producer' | 'altitude' | 'varieties' | 'species'
  | 'flavorProfile' | 'decaf' | 'photos' | 'roastType' | 'roastDate' | 'roastLevel' | 'weightLoss' | 'inventory' | 'price' | 'bagWeight'
  | 'purchaseDate' | 'greenSupplier' | 'website' | 'publicMenu' | 'resting' | 'rating' | 'review' | 'notes';

export interface CarryInfo {
  key: BeanCarryKey;
  label: string;
  // The form's field it goes with: hidden (Settings → Fields), no box. null
  // for the required fields, which can't be hidden.
  field: FieldKey | null;
  // The form's values (BeanFormView's draftRefs names) the box keeps.
  values: readonly string[];
}

const fieldLabel = (field: FieldKey): string => FIELDS.find((f) => f.key === field)?.label ?? field;
const own = (key: BeanCarryKey, label: string, values: readonly string[] = [key]): CarryInfo => ({ key, label, field: null, values });
const field = (key: BeanCarryKey, values: readonly string[] = [key], name: string = key): CarryInfo => {
  const f = `bean.${name}` as FieldKey;
  return { key, label: fieldLabel(f), field: f, values };
};

// In BEAN_CARRY_KEYS order.
export const CARRY_LIST: readonly CarryInfo[] = [
  own('roasterName', 'Roaster'),
  own('beanName', 'Coffee'),
  field('process'),
  field('blendType'),
  field('origin', ['originArea', 'country']),
  field('region'),
  field('producer'),
  field('altitude'),
  field('varieties'),
  field('species'),
  field('flavorProfile'),
  field('decaf'),
  field('photos', []), // the form keeps the files itself
  field('roastType'),
  field('roastDate'),
  field('roastLevel', ['detailedRoastLevel', 'level', 'sourceDetailed', 'savedDetailed', 'savedRoastLevel']),
  field('weightLoss'),
  own('inventory', 'In stock'),
  field('price', ['price', 'currency']),
  field('bagWeight'),
  field('purchaseDate'),
  field('greenSupplier'),
  field('website'),
  own('publicMenu', 'Show on the public menu', ['showOnPublicMenu']),
  field('resting', ['resting', 'restingOn', 'restInPicker']),
  field('rating'),
  field('review'),
  field('notes'),
];
// What starts ticked until the workspace says (Settings → Defaults): the
// coffee, not what belongs to one bag. Matches the shared default.
const PER_BAG: readonly BeanCarryKey[] = ['roastDate', 'weightLoss', 'inventory', 'bagWeight', 'resting', 'rating', 'review'];
export const DEFAULT_BEAN_CARRY: BeanCarryKey[] = CARRY_LIST.map((c) => c.key).filter((k) => !PER_BAG.includes(k));
export const CARRY: Record<BeanCarryKey, CarryInfo> = Object.fromEntries(CARRY_LIST.map((c) => [c.key, c])) as Record<BeanCarryKey, CarryInfo>;

// The values a label read leaves behind, which belong to the bag just saved.
const ALWAYS_RESET = ['suggestions', 'labelSummary', 'webSources'];

// The form for the next batch: what's ticked stays, the rest goes back to
// how the form opened (blank), and the batch number moves on.
export function nextBatchValues(values: Record<string, unknown>, blank: Record<string, unknown>, ticked: readonly BeanCarryKey[]): Record<string, unknown> {
  const out = { ...values };
  const reset = CARRY_LIST.filter((c) => !ticked.includes(c.key)).flatMap((c) => c.values).concat(ALWAYS_RESET);
  for (const name of reset) if (name in blank) out[name] = blank[name];
  out.batchNumber = nextBatch(typeof values.batchNumber === 'string' ? values.batchNumber : null);
  return out;
}
