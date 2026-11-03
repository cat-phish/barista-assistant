// A chat reply's proposals as stored (docs/api/chat.md §12, "Proposals"), for
// checking an imported chats.json. The worker checks what the AI writes.
import { CHAT_PROPOSAL_STATES, CHAT_PROPOSALS_MAX, RECIPE_STEP_TYPES, type ChatProposal } from "@barista/shared/schema";
import { z } from "zod";

const id = z.string().max(36);
const label = z.string().max(300);
const num = z.number().finite();
const step = z
  .object({
    stepType: z.enum(RECIPE_STEP_TYPES),
    label: z.string().max(255).nullable(),
    durationSec: num.nullable(),
    targetWaterGrams: num.nullable(),
    targetTempC: num.nullable(),
    pressureBar: num.nullable(),
    flowRate: num.nullable(),
  })
  .strict();
const recipe = z
  .object({
    name: z.string().min(1).max(255).optional(),
    targetDoseGrams: num.optional(),
    targetWaterGrams: num.nullable().optional(),
    targetIceGrams: num.nullable().optional(),
    expectedYieldGrams: num.nullable().optional(),
    targetTempC: num.nullable().optional(),
    expectedFinishMinSec: num.nullable().optional(),
    expectedFinishMaxSec: num.nullable().optional(),
    steps: z.array(step).max(20).optional(),
  })
  .strict();
const base = { title: z.string().min(1).max(80), why: z.string().min(1).max(600), state: z.enum(CHAT_PROPOSAL_STATES) };
const proposal = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("brew"),
      ...base,
      beanId: id.nullable(),
      beanLabel: label.nullable(),
      recipeId: id.nullable(),
      recipeLabel: label.nullable(),
      grinderId: id.nullable(),
      grinderLabel: label.nullable(),
      grindSetting: num.nullable(),
      tempC: num.nullable(),
      ratio: num.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("recipeChange"), ...base, recipeId: id, recipeLabel: label, changes: recipe }).strict(),
  z.object({ kind: z.literal("newRecipe"), ...base, brewerId: id.nullable(), brewerLabel: label.nullable(), recipe: recipe.extend({ name: z.string().min(1).max(255), targetDoseGrams: num }) }).strict(),
]);
export const proposalsSchema = z.array(proposal).max(CHAT_PROPOSALS_MAX) satisfies z.ZodType<ChatProposal[]>;
