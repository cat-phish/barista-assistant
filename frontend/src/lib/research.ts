// Research settings (docs/api/research.md §1f): labels and the precedence
// the worker uses (the person's choice, then the workspace's default, then
// the finding's own), as @barista/shared/researchSettings has them
// (lib/research.test.ts checks the lists match).
import type { BuiltInFinding, OwnEvidence, OwnFindingInput, ResearchLever, ResearchMode, ResearchScope, ResearchSettings } from '../api/types';

export const RESEARCH_MODES: readonly ResearchMode[] = ['on', 'off', 'experiment'];
export const MODE_LABELS: Record<ResearchMode, string> = { on: 'On', off: 'Off', experiment: 'Only as an experiment' };
export const RESEARCH_LEVERS: readonly ResearchLever[] = ['ratio', 'grind', 'temperature', 'agitation', 'bloom', 'time', 'water', 'rest'];
export const LEVER_LABELS: Record<ResearchLever, string> = { ratio: 'Ratio', grind: 'Grind', temperature: 'Temperature', agitation: 'Agitation', bloom: 'Bloom', time: 'Time', water: 'Water', rest: 'Rest' };
export const OWN_EVIDENCE: readonly OwnEvidence[] = ['peerReviewed', 'controlledTest', 'expert', 'own'];
export const EVIDENCE_LABELS: Record<OwnEvidence, string> = { peerReviewed: 'Peer-reviewed', controlledTest: 'Controlled test', expert: 'Expert opinion', own: 'My own test' };
export const RESEARCH_SCOPES: readonly ResearchScope[] = ['any', 'filter', 'pourOver', 'immersion', 'espresso'];
export const SCOPE_LABELS: Record<ResearchScope, string> = { any: 'Every brew', filter: 'Hot filter', pourOver: 'Pour over', immersion: 'Immersion', espresso: 'Espresso' };

export const defaultMode = (f: Pick<BuiltInFinding, 'experiment'>): ResearchMode => (f.experiment ? 'experiment' : 'on');
export function effectiveMode(f: Pick<BuiltInFinding, 'key' | 'experiment'>, person: ResearchSettings | null, workspace: ResearchSettings | null): ResearchMode {
  return person?.settings[f.key]?.mode ?? workspace?.settings[f.key]?.mode ?? defaultMode(f);
}

// A blank own finding for the form.
export const emptyFinding = (): OwnFindingInput => ({ title: '', text: '', levers: [], evidence: 'expert', scope: 'any', source: null, mode: 'on' });

// Why a finding can't be saved yet, in the form; null when it can.
export function findingProblem(f: OwnFindingInput, limits: { title: number; text: number; source: number }): string | null {
  if (!f.title.trim()) return 'Give it a title.';
  if (f.title.trim().length > limits.title) return `The title is over ${limits.title} characters.`;
  if (!f.text.trim()) return 'Write the finding.';
  if (f.text.trim().length > limits.text) return `The finding is over ${limits.text} characters.`;
  if (!f.levers.length) return 'Pick at least one lever.';
  if ((f.source ?? '').trim().length > limits.source) return `The source is over ${limits.source} characters.`;
  return null;
}
