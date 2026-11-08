import type { DilutionWith, FlowUnit, MethodKind, RecipeStyle, SteepTemp, StepAdvance } from "./schema.js";

// A brew's copy of its recipe, as it was when the brew was logged
// (docs/api/brew-logs.md §6, "Recipe copy"): what the AI judges the brew
// against, so editing or deleting the recipe later doesn't change an old
// brew's analysis (docs/api/llm-contract.md §9). Stored as the recipe wrote
// it; the brew's own scaling (water, stepTempShiftC) is applied when read.
// The backend writes it (backend/src/recipeCopy.ts); the worker reads it.
export interface RecipeCopy {
  name: string;
  brewer: string; // e.g. "V60", "Linea Mini"
  style: { name: string; brewsLike: RecipeStyle } | null; // how it brews
  methodKind: MethodKind;
  targetDoseGrams: number;
  targetWaterGrams: number | null; // null for espresso
  targetIceGrams: number | null; // flash chilled: ice in the server
  expectedYieldGrams: number | null; // estimate; for espresso the target shot weight
  // Target window for total brew (or shot) time, seconds (both or neither).
  expectedFinishMinSec: number | null;
  expectedFinishMaxSec: number | null;
  // Espresso: target window for the first drop, seconds (both or neither).
  firstDropMinSec: number | null;
  firstDropMaxSec: number | null;
  targetTempC: number | null;
  // Step temps move with the brew's water temp (docs/api/recipes.md §5).
  stepTempsFollowBrew: boolean;
  // Cold styles (docs/api/recipes.md §5): the steep window in hours, fridge
  // or room, and the serving dilution the recipe intends.
  steepMinHours: number | null;
  steepMaxHours: number | null;
  steepTemp: SteepTemp | null;
  dilutionRatio: number | null;
  dilutionWith: DilutionWith | null;
  flowUnit: FlowUnit; // for flow steps: g/s or ml/s
  // Filter: the times of steps with scalesWithBatch follow the batch, ×
  // factor^this (docs/api/recipes.md §5); null = none do.
  stepTimeScaling: number | null;
  // In stepOrder. Back to back: each starts when the previous one actually
  // ended (step_end marks say when, for tap/logged steps; step_hold /
  // step_resume when a step was held).
  steps: Array<{
    stepOrder: number;
    stepType: string;
    label: string | null;
    durationSec: number | null; // null = until finish; a guide for tap steps
    advance: StepAdvance;
    targetWaterGrams: number | null; // cumulative "pour to" weight
    targetTempC: number | null;
    pressureBar: number | null;
    pressureEndBar: number | null; // ramp end
    flowRate: number | null;
    flowEndRate: number | null;
    scalesWithBatch: boolean; // sent to the AI only with stepTimeScaling
  }>;
}
