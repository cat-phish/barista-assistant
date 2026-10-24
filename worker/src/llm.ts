import type { AiDetail } from "@barista/shared/aiDetails";
import { GRIND_DELTAS } from "@barista/shared/jobs";
import { ANALYSIS_CONFIDENCE } from "@barista/shared/schema";
import { UnrecoverableError } from "bullmq";
import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";
import type { BrewContext } from "./context.js";
import { buildSystemPrompt, toLlmInput } from "./prompt.js";

// The input and system prompt are built in prompt.ts; the schema and its
// checks are here (docs/api/llm-contract.md §9). PROMPT_VERSION (prompt.ts)
// is stored with each analysis; bump it when any of them change.
export { PROMPT_VERSION } from "./prompt.js";

export const BREW_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description: "A concise 1-2 sentence diagnosis of extraction quality and why adjustments are needed.",
    },
    nextStep: {
      type: "string",
      description: "The one concrete thing to do on the next brew, in plain words (at most 140 characters).",
    },
    confidence: {
      type: "string",
      enum: [...ANALYSIS_CONFIDENCE],
      description: "How sure the suggestion is: low with vague notes, no comparable brew, or measurements that look wrong.",
    },
    suggestedGrindDelta: {
      type: "string",
      enum: [...GRIND_DELTAS],
    },
    suggestedTempDelta: {
      type: "number",
      description: "Suggested change in Celsius (e.g., -1.5, 0, 2.0).",
    },
    suggestedRpmDelta: {
      type: ["integer", "null"],
      description: "Change in grinder speed (RPM) for a variable-speed grinder; null otherwise or to keep the speed.",
    },
    suggestedDoseDelta: {
      type: ["number", "null"],
      description: "Espresso only: change in dose in grams (e.g., 0.5, -1); null for other brews or to keep the dose.",
    },
    suggestedYieldDelta: {
      type: ["number", "null"],
      description: "Espresso only: change in shot weight (beverage out) in grams (e.g., 4, -3); null for other brews or to keep it.",
    },
  },
  required: ["reasoning", "nextStep", "confidence", "suggestedGrindDelta", "suggestedTempDelta", "suggestedRpmDelta", "suggestedDoseDelta", "suggestedYieldDelta"],
  additionalProperties: false,
} as const;

const MAX_TEMP_DELTA_C = 10;
const MAX_DOSE_DELTA_G = 5;
const MAX_YIELD_DELTA_G = 30;

// Grams to the column's 1 decimal, within ±max (outside fails the attempt).
const gramsDelta = (max: number) =>
  z
    .number()
    .transform((n) => Math.round(n * 10) / 10)
    .refine((n) => Math.abs(n) <= max, `must be within ±${max} g`)
    .nullable();

// Strict mode should guarantee the shape; validate anyway (§9). Temp delta is
// rounded to the column's 1 decimal; out-of-range values fail the attempt.
const MAX_RPM_DELTA = 1000;
const analysisSchema = z.object({
  reasoning: z.string().trim().min(1).max(2000),
  nextStep: z.string().trim().min(1).max(200), // the column's size; asked for 140
  confidence: z.enum(ANALYSIS_CONFIDENCE),
  suggestedRpmDelta: z.number().int().min(-MAX_RPM_DELTA).max(MAX_RPM_DELTA).nullable(),
  suggestedDoseDelta: gramsDelta(MAX_DOSE_DELTA_G),
  suggestedYieldDelta: gramsDelta(MAX_YIELD_DELTA_G),
  suggestedGrindDelta: z.enum(GRIND_DELTAS),
  suggestedTempDelta: z
    .number()
    .transform((n) => Math.round(n * 10) / 10)
    .refine((n) => Math.abs(n) <= MAX_TEMP_DELTA_C, `must be within ±${MAX_TEMP_DELTA_C} °C`),
});

export type BrewAnalysis = z.infer<typeof analysisSchema>;

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// The exact request sent to OpenAI (pure, so tests can check it against §9):
// the compact input, and the prompt sections it needs. `hidden` is what the
// workspace keeps from the AI (Settings → AI).
export function buildCompletionRequest(context: BrewContext, hidden: ReadonlySet<AiDetail> = new Set()): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const input = toLlmInput(context, hidden);
  return {
    model: config.openaiModel,
    messages: [
      { role: "system", content: buildSystemPrompt(input) },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "brew_analysis", strict: true, schema: BREW_ANALYSIS_JSON_SCHEMA },
    },
  };
}

// Turns the model's reply into a validated analysis, or throws (which makes
// BullMQ retry the job).
export function parseAnalysisMessage(
  message: { content?: string | null; refusal?: string | null } | undefined
): BrewAnalysis {
  if (message?.refusal) throw new Error(`LLM refused: ${message.refusal}`);
  if (!message?.content) throw new Error("LLM returned an empty response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(message.content);
  } catch {
    throw new Error("LLM returned invalid JSON");
  }

  const result = analysisSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`LLM response failed validation: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return result.data;
}

export async function analyzeWithLlm(context: BrewContext, hidden: ReadonlySet<AiDetail> = new Set()): Promise<BrewAnalysis> {
  return (await requestAnalysis(context, hidden)).analysis;
}

// The analysis plus what it cost, for the eval script (src/eval.ts).
export interface AnalysisRun {
  analysis: BrewAnalysis;
  usage: { promptTokens: number; completionTokens: number } | null;
}
export async function requestAnalysis(context: BrewContext, hidden: ReadonlySet<AiDetail> = new Set()): Promise<AnalysisRun> {
  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    completion = await openai.chat.completions.create(buildCompletionRequest(context, hidden));
  } catch (err) {
    // Bad key, unknown model, malformed request: retrying won't help.
    if (err instanceof OpenAI.APIError && err.status !== undefined && [400, 401, 403, 404].includes(err.status)) {
      throw new UnrecoverableError(`OpenAI rejected the request (${err.status}): ${err.message}`);
    }
    throw err; // 429 / 5xx / network: let BullMQ retry with backoff
  }
  const usage = completion.usage ? { promptTokens: completion.usage.prompt_tokens, completionTokens: completion.usage.completion_tokens } : null;
  return { analysis: onlyWhatApplies(parseAnalysisMessage(completion.choices[0]?.message), context, hidden), usage };
}

// Drops the changes that don't apply to this brew (§9), whatever the model said.
export function onlyWhatApplies(analysis: BrewAnalysis, context: BrewContext, hidden: ReadonlySet<AiDetail>): BrewAnalysis {
  const out = { ...analysis };
  // A speed change only means something on a variable-speed grinder whose speed the AI may see.
  if (!context.brew.grinder?.variableSpeed || hidden.has("rpm")) out.suggestedRpmDelta = null;
  // Dose and shot weight are espresso's levers; a filter brew's ratio comes from its recipe.
  if (context.brew.methodKind !== "espresso") {
    out.suggestedDoseDelta = null;
    out.suggestedYieldDelta = null;
  }
  // A change of nothing is no change.
  if (out.suggestedDoseDelta === 0) out.suggestedDoseDelta = null;
  if (out.suggestedYieldDelta === 0) out.suggestedYieldDelta = null;
  return out;
}
