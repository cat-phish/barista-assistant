// What a chat proposal card says (docs/api/chat.md §12, "Proposals"), and
// where opening it goes.
import type { ChatProposal, ChatProposalRecipe } from '../api/chats';
import type { TemperatureUnit } from '../api/types';
import { formatGrams, formatGrind, formatTime } from './format';
import { STEP_TYPES } from './steps';
import { formatTemp } from './units';

export const PROPOSAL_KIND_LABELS: Record<ChatProposal['kind'], string> = {
  brew: 'Next brew',
  recipeChange: 'Recipe change',
  newRecipe: 'New recipe',
};

const finishWindow = (min: number | null | undefined, max: number | null | undefined): string | null =>
  min != null && max != null ? `${formatTime(min)}–${formatTime(max)}` : min != null ? `from ${formatTime(min)}` : max != null ? `by ${formatTime(max)}` : null;

// A recipe's values, a line each: "Dose 15 g", "Steps: Bloom 45 g, Pour 250 g".
export function recipeLines(r: ChatProposalRecipe, unit: TemperatureUnit): string[] {
  const lines: string[] = [];
  const grams = (label: string, v: number | null | undefined) => {
    if (v !== undefined) lines.push(v === null ? `${label}: none` : `${label} ${formatGrams(v)} g`);
  };
  grams('Dose', r.targetDoseGrams);
  grams('Water', r.targetWaterGrams);
  grams('Ice', r.targetIceGrams);
  grams('Yield', r.expectedYieldGrams);
  if (r.targetTempC !== undefined) lines.push(r.targetTempC === null ? 'Temperature: none' : `Temperature ${formatTemp(r.targetTempC, unit)}`);
  if (r.expectedFinishMinSec !== undefined || r.expectedFinishMaxSec !== undefined) {
    const w = finishWindow(r.expectedFinishMinSec, r.expectedFinishMaxSec);
    lines.push(w ? `Finish ${w}` : 'Finish window: none');
  }
  if (r.steps) {
    const steps = r.steps.map((s) => [s.label || STEP_TYPES[s.stepType].label, s.targetWaterGrams != null ? `${formatGrams(s.targetWaterGrams)} g` : null, s.durationSec != null ? formatTime(s.durationSec) : null].filter(Boolean).join(' '));
    lines.push(steps.length ? `Steps: ${steps.join(', ')}` : 'Steps: none');
  }
  return lines;
}

// What the card lists under its title.
export function proposalLines(p: ChatProposal, unit: TemperatureUnit): string[] {
  if (p.kind === 'brew') {
    return [
      p.beanLabel && `Bean: ${p.beanLabel}`,
      p.recipeLabel && `Recipe: ${p.recipeLabel}`,
      p.grindSetting !== null && `Grind ${formatGrind(p.grindSetting)}${p.grinderLabel ? ` on ${p.grinderLabel}` : ''}`,
      p.tempC !== null && `Temperature ${formatTemp(p.tempC, unit)}`,
      p.ratio !== null && `Ratio 1:${formatGrams(Math.round(p.ratio * 10) / 10)}`,
    ].filter((x): x is string => !!x);
  }
  if (p.kind === 'recipeChange') return [`Recipe: ${p.recipeLabel}`, ...recipeLines(p.changes, unit)];
  const { name: _name, ...values } = p.recipe;
  return [p.brewerLabel ? `Brewer: ${p.brewerLabel}` : 'Brewer: you choose', ...recipeLines(values, unit)];
}

// The page opening it fills in.
export function proposalRoute(p: ChatProposal): { name: string; params?: Record<string, string>; query: Record<string, string> } {
  if (p.kind === 'brew') return { name: 'brew', query: { proposal: '1' } };
  if (p.kind === 'recipeChange') return { name: 'recipe-edit', params: { id: p.recipeId }, query: { proposal: '1' } };
  return { name: 'recipe-new', query: { proposal: '1' } };
}
