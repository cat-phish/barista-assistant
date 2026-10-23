// Prep tools on the brew checklist (docs/api/prep-tools.md §3d). Unit-tested
// in prepTools.test.ts.
import type { MethodKind, PrepTool } from '../api/types';
import { METHOD_KINDS } from './equipment';

export const methodLabel = (kind: MethodKind | null): string => (kind ? METHOD_KINDS[kind].label : 'All methods');

// The checklist for a brew, in the tools' order: active tools for its method
// (kind null = no recipe: every method) and for all methods, plus any the brew
// already has, even if since archived or moved to another method.
export function toolsFor(tools: readonly PrepTool[], kind: MethodKind | null, selected: readonly string[]): PrepTool[] {
  return tools.filter(
    (t) => selected.includes(t.id) || (!t.archivedAt && (kind === null || t.methodKind === null || t.methodKind === kind)),
  );
}
