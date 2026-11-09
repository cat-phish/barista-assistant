// A rough count of the tokens a chat's attachments add to every reply
// (docs/api/chat.md §12, "Periods"), for the warning in the picker and under
// the chips. Per-kind averages from the JSON the worker sends (about 4
// characters a token), measured on a real journal in Nov 2026: an attached
// brew carries its bean and equipment; a period's brews are leaner.
import type { ChatAttachment } from '../api/chats';

export const TOKENS = {
  brew: 610,
  bean: 100,
  recipe: 320,
  chartBase: 60,
  chartRow: 10,
  periodBase: 450, // its figures and the period before's
  periodBrew: 190,
} as const;
// Past this, the warning shows.
export const TOKEN_WARNING = 20_000;

// periodBrews: how many brews each period holds now, by attachment id
// (unknown: counted at the cap).
export function estimateTokens(selection: readonly ChatAttachment[], periodBrews: ReadonlyMap<string, number>, periodCap: number): number {
  return selection.reduce((n, a) => {
    if (a.kind === 'chart') return n + TOKENS.chartBase + TOKENS.chartRow * (a.chart?.rows.length ?? 0);
    if (a.kind === 'period') return n + TOKENS.periodBase + TOKENS.periodBrew * Math.min(periodBrews.get(a.id) ?? periodCap, periodCap);
    return n + TOKENS[a.kind];
  }, 0);
}

// "≈ 40k tokens, sent again with every reply"; null below the warning.
export function tokenWarning(tokens: number): string | null {
  if (tokens < TOKEN_WARNING) return null;
  return `≈ ${Math.round(tokens / 1000)}k tokens, sent again with every reply. Large attachments cost more on each one.`;
}
