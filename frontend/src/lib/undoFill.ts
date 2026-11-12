// Undo for the bean form's "Fill in with AI" (docs/api/bean-label.md §4d):
// what a fill changed goes back, unless it's been edited since.
export type FormSnapshot = Record<string, unknown>;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The values to put back: each one the fill changed that still says what the fill put there. */
export function undoChanges(before: FormSnapshot, after: FormSnapshot, current: FormSnapshot): FormSnapshot {
  return Object.fromEntries(
    Object.keys(before)
      .filter((key) => !same(before[key], after[key]) && same(current[key], after[key]))
      .map((key) => [key, before[key]]),
  );
}
