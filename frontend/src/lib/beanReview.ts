// "Suggest with AI" on a bean's Review (docs/api/analysis.md §8e): which brewers
// its dialog starts with, and what it asks with.
import type { BeanReviewRequest } from '../api/beans';

// The workspace's choice among the brewers this bean used; all of them when
// it's "all" or none of its brewers apply.
export function startingBrewers(defaults: 'all' | string[], used: readonly { id: string }[]): string[] {
  const all = used.map((b) => b.id);
  if (defaults === 'all') return all;
  const picked = all.filter((id) => defaults.includes(id));
  return picked.length ? picked : all;
}

// The Review as a PATCH sends it: nothing when it's unchanged.
export function reviewChange(text: string, saved: string | null): { review?: string | null } {
  const review = text.trim() || null;
  return review === saved ? {} : { review };
}

// All brewers ticked means every brew, even one with no brewer (null).
export function reviewRequest(choice: { ticked: readonly string[]; used: readonly { id: string }[]; maxBrews: number; ratedOnly: boolean; note: string }): BeanReviewRequest {
  const all = choice.used.every((b) => choice.ticked.includes(b.id));
  const note = choice.note.trim();
  return { brewerIds: all ? null : [...choice.ticked], maxBrews: choice.maxBrews, ratedOnly: choice.ratedOnly, ...(note ? { note } : {}) };
}
