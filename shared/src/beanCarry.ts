// Batch add (docs/api/beans.md §4, "Frontend (batch add)"): the Add bean
// form's "Carry over" boxes. Next batch saves the bean and keeps what's
// ticked for the next one. WorkspaceSettings.beanCarryOver lists the ones
// that start ticked. The frontend has the labels (lib/beanCarry.ts; its
// test checks they match). The batch number has no box: Next moves it on.
export const BEAN_CARRY_KEYS = [
  "roasterName",
  "beanName",
  "process",
  "blendType",
  "origin", // growing area and country
  "region",
  "producer",
  "altitude",
  "varieties",
  "species",
  "flavorProfile",
  "decaf",
  "photos",
  "roastType",
  "roastDate",
  "roastLevel",
  "weightLoss",
  "inventory",
  "price", // with its currency
  "bagWeight",
  "purchaseDate",
  "greenSupplier",
  "website",
  "publicMenu",
  "resting", // the ready day and the brew picker box
  "rating",
  "review",
  "notes",
] as const;
export type BeanCarryKey = (typeof BEAN_CARRY_KEYS)[number];

// What belongs to one bag starts unticked; the coffee carries over.
const PER_BAG: readonly BeanCarryKey[] = ["roastDate", "weightLoss", "inventory", "bagWeight", "resting", "rating", "review"];
export const DEFAULT_BEAN_CARRY: BeanCarryKey[] = BEAN_CARRY_KEYS.filter((k) => !PER_BAG.includes(k));
