// Ratings (docs/api/brew-logs.md §6): 0.5-5 in half steps. The workspace's
// ratingStep (docs/api/workspaces.md §2) only changes how they're entered.
import type { RatingStep } from '../api/types';

export type StarFill = 'full' | 'half' | 'empty';

const LABELS = ['', 'Bad', 'Meh', 'OK', 'Good', 'Great'];

// How each of the 5 stars shows a rating: 3.5 is three full, one half, one empty.
// Shown as fill-<fill> classes: a bare "empty" would pick up base.css's .empty.
export function starFills(rating: number): StarFill[] {
  return [1, 2, 3, 4, 5].map((n) => (rating >= n ? 'full' : rating >= n - 0.5 ? 'half' : 'empty'));
}

// The values star n (1-5) offers: its left half then the whole star, or the
// whole star only.
export function starValues(n: number, step: RatingStep): number[] {
  return step === 'half' ? [n - 0.5, n] : [n];
}

// "4 – Good" for a whole star, "3.5" between two.
export function ratingLabel(rating: number): string {
  return Number.isInteger(rating) ? `${rating} – ${LABELS[rating]}` : String(rating);
}
