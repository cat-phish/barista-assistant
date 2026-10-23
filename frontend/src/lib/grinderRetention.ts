// Coffee left in the grinder: beans weighed in − grounds out (docs/api/brew-logs.md §6).
// Not the water the coffee bed keeps (lib/scale.ts), which is a different thing.
export function grinderRetention(beanInGrams: number | null, groundOutGrams: number | null): { grams: number; percent: number } | null {
  if (beanInGrams === null || groundOutGrams === null || !(beanInGrams > 0) || groundOutGrams > beanInGrams) return null;
  const grams = Math.round((beanInGrams - groundOutGrams) * 100) / 100;
  return { grams, percent: Math.round((grams / beanInGrams) * 1000) / 10 };
}

// "Grinder retention 0.3 g (1.6%)", or '' without both weights.
export function grinderRetentionText(beanInGrams: number | null, groundOutGrams: number | null): string {
  const r = grinderRetention(beanInGrams, groundOutGrams);
  return r ? `Grinder retention ${r.grams} g (${r.percent}%)` : '';
}
