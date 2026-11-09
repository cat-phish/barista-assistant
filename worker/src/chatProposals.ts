// Proposals in a chat reply (docs/api/llm-contract.md §9e, "Proposals"): the
// model ends its reply with ```proposal blocks of JSON. They're held back from
// the stream, taken out of the saved text, checked and saved on the message
// for the chat to show as cards (docs/api/chat.md §12).
import {
  beans,
  brewers,
  brewLogs,
  CHAT_PROPOSALS_MAX,
  grinders,
  RECIPE_STEP_TYPES,
  recipes,
  recipeSteps,
  type MethodKind,
  type ChatAttachment,
  type ChatProposal,
  type ChatProposalRecipe,
} from "@barista/shared/schema";
import { recipeStepWarnings, type CheckedRecipe } from "@barista/shared/recipeChecks";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.js";
import { RATIO_RANGE } from "./llm.js";

export const PROPOSAL_FENCE = "```proposal";

// Passes text on until a proposal block starts, then holds the rest back.
// A piece that could be the start of the fence waits for the next one.
export function proposalFilter(onText: (text: string) => void): { add(text: string): void; end(): void } {
  let held = "";
  let inside = false;
  const partial = (s: string): number => {
    for (let n = Math.min(s.length, PROPOSAL_FENCE.length - 1); n > 0; n--) if (PROPOSAL_FENCE.startsWith(s.slice(-n))) return n;
    return 0;
  };
  return {
    add(text) {
      if (inside) return;
      const all = held + text;
      const at = all.indexOf(PROPOSAL_FENCE);
      if (at >= 0) {
        inside = true;
        held = "";
        const before = all.slice(0, at).trimEnd();
        if (before) onText(before);
        return;
      }
      // Spaces at the end wait too, so the text doesn't end on the gap
      // before a block.
      const cut = all.length - partial(all);
      const keep = all.length - all.slice(0, cut).trimEnd().length;
      held = all.slice(all.length - keep);
      const out = all.slice(0, all.length - keep);
      if (out) onText(out);
    },
    end() {
      if (!inside && held) onText(held);
      held = "";
    },
  };
}

// The reply without its proposal blocks, and what each block held. A block
// cut off by the end of the reply is read as far as it goes.
export function splitProposals(reply: string): { text: string; blocks: unknown[] } {
  const blocks: unknown[] = [];
  const text = reply.replace(/```proposal[^\n]*\n?([\s\S]*?)(?:```|$)/g, (_, body: string) => {
    try {
      blocks.push(JSON.parse(body));
    } catch {
      // not JSON: left out
    }
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), blocks };
}

// What a ref names, read from the journal when the reply is checked.
export interface RefTarget {
  kind: ChatAttachment["kind"];
  id: string;
  label: string;
  bean?: { id: string; label: string } | null;
  // current: the recipe as saved, for checking a change to it (recipeStepWarnings).
  recipe?: { id: string; label: string; current?: CheckedRecipe } | null;
  brewer?: { id: string; label: string; kind: MethodKind } | null;
  grinder?: { id: string; label: string; min: number | null; max: number | null } | null;
}
export type RefTable = Map<string, RefTarget>;

// Each attachment's ref, as the AI is sent it: a1, a2, … in order.
export const refOf = (index: number): string => `a${index + 1}`;

export async function refTable(attachments: readonly ChatAttachment[], workspaceId: string): Promise<RefTable> {
  const ids = (kind: ChatAttachment["kind"]) => attachments.filter((a) => a.kind === kind).map((a) => a.id);
  const brewIds = ids("brew");
  const recipeIds = ids("recipe");
  const beanIds = ids("bean");
  const [brewRows, recipeRows, beanRows] = await Promise.all([
    brewIds.length
      ? db
          .select({
            id: brewLogs.id,
            beanId: beans.id,
            roaster: beans.roasterName,
            beanName: beans.beanName,
            recipeId: recipes.id,
            recipeName: recipes.name,
            brewerId: brewers.id,
            brewerName: brewers.name,
            brewerKind: brewers.kind,
            grinderId: grinders.id,
            grinderName: grinders.name,
            min: grinders.settingMin,
            max: grinders.settingMax,
          })
          .from(brewLogs)
          .leftJoin(beans, eq(brewLogs.beanId, beans.id))
          .leftJoin(recipes, eq(brewLogs.recipeId, recipes.id))
          .leftJoin(brewers, eq(brewLogs.brewerId, brewers.id))
          .leftJoin(grinders, eq(brewLogs.grinderId, grinders.id))
          .where(and(inArray(brewLogs.id, brewIds), eq(brewLogs.workspaceId, workspaceId)))
      : [],
    recipeIds.length
      ? db
          .select({ id: recipes.id, name: recipes.name, brewerId: brewers.id, brewerName: brewers.name, brewerKind: brewers.kind })
          .from(recipes)
          .innerJoin(brewers, eq(recipes.brewerId, brewers.id))
          .where(and(inArray(recipes.id, recipeIds), eq(recipes.workspaceId, workspaceId)))
      : [],
    beanIds.length
      ? db.select({ id: beans.id, roaster: beans.roasterName, beanName: beans.beanName }).from(beans).where(and(inArray(beans.id, beanIds), eq(beans.workspaceId, workspaceId)))
      : [],
  ]);
  const beanLabel = (roaster: string | null, name: string | null) => [roaster, name].filter(Boolean).join(" ");
  const table: RefTable = new Map();
  attachments.forEach((a, i) => {
    const base = { kind: a.kind, id: a.id, label: a.label };
    if (a.kind === "brew") {
      const r = brewRows.find((x) => x.id === a.id);
      if (!r) return;
      table.set(refOf(i), {
        ...base,
        bean: r.beanId ? { id: r.beanId, label: beanLabel(r.roaster, r.beanName) } : null,
        recipe: r.recipeId && r.recipeName ? { id: r.recipeId, label: r.recipeName } : null,
        brewer: r.brewerId && r.brewerName && r.brewerKind ? { id: r.brewerId, label: r.brewerName, kind: r.brewerKind } : null,
        grinder: r.grinderId && r.grinderName ? { id: r.grinderId, label: r.grinderName, min: r.min, max: r.max } : null,
      });
    } else if (a.kind === "recipe") {
      const r = recipeRows.find((x) => x.id === a.id);
      if (r) table.set(refOf(i), { ...base, recipe: { id: r.id, label: r.name }, brewer: { id: r.brewerId, label: r.brewerName, kind: r.brewerKind } });
    } else if (a.kind === "bean") {
      const r = beanRows.find((x) => x.id === a.id);
      if (r) table.set(refOf(i), { ...base, bean: { id: r.id, label: beanLabel(r.roaster, r.beanName) } });
    }
  });
  await addCurrentRecipes(table, workspaceId);
  return table;
}

// The saved values and steps of every recipe the refs point to.
async function addCurrentRecipes(table: RefTable, workspaceId: string): Promise<void> {
  const ids = [...new Set([...table.values()].flatMap((t) => (t.recipe ? [t.recipe.id] : [])))];
  if (!ids.length) return;
  const [rows, steps] = await Promise.all([
    db
      .select({ id: recipes.id, targetWaterGrams: recipes.targetWaterGrams, expectedFinishMinSec: recipes.expectedFinishMinSec, expectedFinishMaxSec: recipes.expectedFinishMaxSec })
      .from(recipes)
      .where(and(inArray(recipes.id, ids), eq(recipes.workspaceId, workspaceId))),
    db
      .select({ recipeId: recipeSteps.recipeId, stepType: recipeSteps.stepType, durationSec: recipeSteps.durationSec, targetWaterGrams: recipeSteps.targetWaterGrams })
      .from(recipeSteps)
      .where(inArray(recipeSteps.recipeId, ids))
      .orderBy(asc(recipeSteps.stepOrder)),
  ]);
  for (const t of table.values()) {
    const r = t.recipe && rows.find((x) => x.id === t.recipe!.id);
    if (!t.recipe || !r) continue;
    t.recipe.current = {
      targetWaterGrams: r.targetWaterGrams,
      expectedFinishMinSec: r.expectedFinishMinSec,
      expectedFinishMaxSec: r.expectedFinishMaxSec,
      steps: steps.filter((s) => s.recipeId === r.id).map((s) => ({ stepType: s.stepType as CheckedRecipe["steps"][number]["stepType"], durationSec: s.durationSec, targetWaterGrams: s.targetWaterGrams })),
    };
  }
}

// What the AI writes in a block. Out-of-range values drop the proposal.
const ref = z.string().max(10);
const grams = z.number().gt(0).lt(10000);
const temp = z.number().min(0).max(100);
const secs = z.number().int().min(0).max(86400);
const text = (max: number) => z.string().trim().min(1).max(max);
const stepSchema = z.object({
  stepType: z.enum(RECIPE_STEP_TYPES),
  label: z.string().trim().max(255).nullish(),
  durationSec: secs.nullish(),
  targetWaterGrams: grams.nullish(),
  targetTempC: temp.nullish(),
  pressureBar: z.number().min(0).max(20).nullish(),
  flowRate: z.number().min(0).max(20).nullish(),
});
const recipeSchema = z.object({
  name: text(255).optional(),
  targetDoseGrams: z.number().gt(0).lt(1000).optional(),
  targetWaterGrams: grams.nullish(),
  targetIceGrams: grams.nullish(),
  expectedYieldGrams: grams.nullish(),
  targetTempC: temp.nullish(),
  expectedFinishMinSec: secs.nullish(),
  expectedFinishMaxSec: secs.nullish(),
  steps: z.array(stepSchema).max(20).optional(),
});
const common = { title: text(80), why: text(600) };
const blockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("brew"),
    ...common,
    from: ref.nullish(),
    bean: ref.nullish(),
    recipe: ref.nullish(),
    grindSetting: z.number().min(0).max(10000).nullish(),
    tempC: temp.nullish(),
    ratio: z.number().gt(0).max(100).nullish(),
  }),
  z.object({ kind: z.literal("recipeChange"), ...common, recipe: ref, changes: recipeSchema }),
  z.object({ kind: z.literal("newRecipe"), ...common, basedOn: ref.nullish(), recipe: recipeSchema }),
]);

const round = (n: number, places: number): number => Number(n.toFixed(places));
const roundOr = (n: number | null | undefined, places: number): number | null => (n == null ? null : round(n, places));

function recipeValues(r: z.infer<typeof recipeSchema>): ChatProposalRecipe {
  const out: ChatProposalRecipe = {};
  if (r.name !== undefined) out.name = r.name;
  if (r.targetDoseGrams !== undefined) out.targetDoseGrams = round(r.targetDoseGrams, 2);
  for (const key of ["targetWaterGrams", "targetIceGrams", "expectedYieldGrams"] as const) if (r[key] !== undefined) out[key] = roundOr(r[key], 2);
  if (r.targetTempC !== undefined) out.targetTempC = roundOr(r.targetTempC, 1);
  if (r.expectedFinishMinSec !== undefined) out.expectedFinishMinSec = r.expectedFinishMinSec ?? null;
  if (r.expectedFinishMaxSec !== undefined) out.expectedFinishMaxSec = r.expectedFinishMaxSec ?? null;
  if (r.steps !== undefined) {
    out.steps = r.steps.map((s) => ({
      stepType: s.stepType,
      label: s.label || null,
      durationSec: s.durationSec ?? null,
      targetWaterGrams: roundOr(s.targetWaterGrams, 2),
      targetTempC: roundOr(s.targetTempC, 1),
      pressureBar: roundOr(s.pressureBar, 1),
      flowRate: roundOr(s.flowRate, 1),
    }));
  }
  return out;
}
// What a proposal's recipe values say against the step checks; a change is
// checked as the recipe after it, and only when it touches the steps, the
// water or the window (a recipe's old quirks aren't the proposal's).
function stepWarnings(values: ChatProposalRecipe, kind: MethodKind, current?: CheckedRecipe): string[] {
  const touches = values.steps !== undefined || values.targetWaterGrams !== undefined || values.expectedFinishMinSec !== undefined || values.expectedFinishMaxSec !== undefined;
  if (!touches) return [];
  const base: CheckedRecipe = current ?? { targetWaterGrams: null, expectedFinishMinSec: null, expectedFinishMaxSec: null, steps: [] };
  return recipeStepWarnings(
    {
      targetWaterGrams: values.targetWaterGrams !== undefined ? values.targetWaterGrams : base.targetWaterGrams,
      expectedFinishMinSec: values.expectedFinishMinSec !== undefined ? values.expectedFinishMinSec : base.expectedFinishMinSec,
      expectedFinishMaxSec: values.expectedFinishMaxSec !== undefined ? values.expectedFinishMaxSec : base.expectedFinishMaxSec,
      steps: values.steps ?? base.steps,
    },
    kind,
  );
}
const withWarnings = (warnings: string[]): { warnings?: string[] } => (warnings.length ? { warnings } : {});

const finishOk = (r: ChatProposalRecipe): boolean => r.expectedFinishMinSec == null || r.expectedFinishMaxSec == null || r.expectedFinishMinSec <= r.expectedFinishMaxSec;

// One block as saved, or null when it doesn't hold up: not the shape asked
// for, a ref to nothing attached (or of the wrong kind), or nothing to do.
export function checkProposal(raw: unknown, refs: RefTable): ChatProposal | null {
  const parsed = blockSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const target = (r: string | null | undefined) => (r ? (refs.get(r) ?? null) : null);
  const base = { title: p.title, why: p.why, state: "open" as const };

  if (p.kind === "brew") {
    const from = target(p.from);
    if (p.from && (!from || from.kind !== "brew")) return null;
    const beanRef = target(p.bean);
    const recipeRef = target(p.recipe);
    if ((p.bean && !beanRef?.bean) || (p.recipe && !recipeRef?.recipe)) return null;
    const bean = beanRef?.bean ?? from?.bean ?? null;
    const recipe = recipeRef?.recipe ?? from?.recipe ?? null;
    const brewer = recipeRef?.brewer ?? from?.brewer ?? null;
    const grinder = from?.grinder ?? null;
    // What doesn't apply is left out, as Suggest parameters does (§9b).
    const onDial = (g: number) => !grinder || ((grinder.min === null || g >= grinder.min) && (grinder.max === null || g <= grinder.max));
    const grindSetting = grinder && p.grindSetting != null && onDial(p.grindSetting) ? round(p.grindSetting, 2) : null;
    const [lo, hi] = brewer?.kind === "espresso" ? RATIO_RANGE.espresso : RATIO_RANGE.filter;
    const ratio = p.ratio != null && p.ratio >= lo && p.ratio <= hi ? round(p.ratio, 2) : null;
    const tempC = roundOr(p.tempC, 1);
    if (!bean && !recipe && grindSetting === null && tempC === null && ratio === null) return null;
    return {
      kind: "brew",
      ...base,
      beanId: bean?.id ?? null,
      beanLabel: bean?.label ?? null,
      recipeId: recipe?.id ?? null,
      recipeLabel: recipe?.label ?? null,
      grinderId: grindSetting === null ? null : grinder!.id,
      grinderLabel: grindSetting === null ? null : grinder!.label,
      grindSetting,
      tempC,
      ratio,
    };
  }
  if (p.kind === "recipeChange") {
    const ref = target(p.recipe);
    const recipe = ref?.recipe;
    if (!recipe) return null;
    const changes = recipeValues(p.changes);
    if (!Object.keys(changes).length || !finishOk(changes)) return null;
    const warnings = stepWarnings(changes, ref.brewer?.kind ?? "filter", recipe.current);
    return { kind: "recipeChange", ...base, recipeId: recipe.id, recipeLabel: recipe.label, changes, ...withWarnings(warnings) };
  }
  const based = target(p.basedOn);
  if (p.basedOn && !based?.brewer) return null;
  const values = recipeValues(p.recipe);
  if (values.name === undefined || values.targetDoseGrams === undefined || !finishOk(values)) return null;
  return {
    kind: "newRecipe",
    ...base,
    brewerId: based?.brewer?.id ?? null,
    brewerLabel: based?.brewer?.label ?? null,
    recipe: { ...values, name: values.name, targetDoseGrams: values.targetDoseGrams },
    ...withWarnings(stepWarnings(values, based?.brewer?.kind ?? "filter")),
  };
}

export const checkProposals = (blocks: readonly unknown[], refs: RefTable): ChatProposal[] =>
  blocks
    .map((b) => checkProposal(b, refs))
    .filter((p): p is ChatProposal => p !== null)
    .slice(0, CHAT_PROPOSALS_MAX);
