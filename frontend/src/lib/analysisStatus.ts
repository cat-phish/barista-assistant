// Where a brew's AI suggestion stands (docs/api/analysis.md §8), for the
// journal's cards and entry.
import type { BrewLog } from '../api/types';

export type AnalysisStatus =
  | { kind: 'done' } // has a suggestion
  | { kind: 'steeping' } // nothing to judge yet
  | { kind: 'due'; at: string } // auto-analyze will run then
  | { kind: 'none'; reason: string | null }; // not analyzed; reason: why the last one failed or wasn't made

type Fields = Pick<BrewLog, 'analyzed' | 'analysisDueAt' | 'analysisError' | 'steeping'>;

export function analysisStatus(log: Fields): AnalysisStatus {
  if (log.steeping) return { kind: 'steeping' };
  if (log.analysisDueAt) return { kind: 'due', at: log.analysisDueAt };
  if (log.analyzed) return { kind: 'done' };
  return { kind: 'none', reason: log.analysisError };
}

// "9:15"
export const formatClock = (iso: string): string => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
