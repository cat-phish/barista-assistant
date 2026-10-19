// BullMQ contract between the backend (producer) and the worker (consumer).
// See docs/api_spec.md §9.

export const BREW_ANALYSIS_QUEUE = "brew-analysis";
export const BREW_ANALYSIS_JOB = "analyze";

export interface BrewAnalysisJobData {
  brewLogId: string;
}

// One job per brew log while it's waiting or running, so repeated clicks
// don't queue duplicate LLM calls. BullMQ custom IDs must not contain ":".
export function brewAnalysisJobId(brewLogId: string): string {
  return `analyze-${brewLogId}`;
}

export const GRIND_DELTAS = ["much_finer", "finer", "no_change", "coarser", "much_coarser"] as const;
export type GrindDelta = (typeof GRIND_DELTAS)[number];
