import type { AiDetail } from "@barista/shared/aiDetails";
import { GRIND_DELTAS } from "@barista/shared/jobs";
import { ANALYSIS_CONFIDENCE, SUGGEST_ALTERNATIVES, type AiRequest, type AlternativeKind, type SuggestedAlternative } from "@barista/shared/schema";
import { UnrecoverableError } from "bullmq";
import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";
import type { BrewContext } from "./context.js";
import { buildSystemPrompt, PROMPT_SECTIONS, promptSections, SUGGEST_SECTIONS, toLlmInput, toSuggestInput, type PromptCustom } from "./prompt.js";
import type { SuggestContext } from "./suggestContext.js";

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
// workspace keeps from the AI (Settings → AI); `custom` what the barista
// adds to the prompt (docs/api/auth.md §1c).
export function buildCompletionRequest(
  context: BrewContext,
  hidden: ReadonlySet<AiDetail> = new Set(),
  custom?: PromptCustom,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const input = toLlmInput(context, hidden);
  return {
    model: config.openaiModel,
    messages: [
      { role: "system", content: buildSystemPrompt(input, PROMPT_SECTIONS, custom) },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "brew_analysis", strict: true, schema: BREW_ANALYSIS_JSON_SCHEMA },
    },
  };
}

// What was sent, as saved with the result (docs/api/analysis.md §8c): read
// back from the request itself, so it can't drift from it.
function sent(request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, sections: string[]): AiRequest {
  const [system, user] = request.messages;
  return { sections, system: String(system?.content ?? ""), input: JSON.parse(String(user?.content ?? "{}")) as Record<string, unknown> };
}
export function analysisSent(context: BrewContext, hidden: ReadonlySet<AiDetail> = new Set(), custom?: PromptCustom): AiRequest {
  return sent(buildCompletionRequest(context, hidden, custom), promptSections(toLlmInput(context, hidden), PROMPT_SECTIONS, custom));
}
export function suggestionSent(context: SuggestContext, hidden: ReadonlySet<AiDetail> = new Set(), custom?: PromptCustom): AiRequest {
  return sent(buildSuggestRequest(context, hidden, custom), promptSections(toSuggestInput(context, hidden), SUGGEST_SECTIONS, custom));
}

export type LlmMessage = { content?: string | null; refusal?: string | null } | undefined;

// Turns the model's reply into what the schema says, or throws (which makes
// BullMQ retry the job).
export function parseMessage<T extends z.ZodType>(message: LlmMessage, schema: T): z.infer<T> {
  if (message?.refusal) throw new Error(`LLM refused: ${message.refusal}`);
  if (!message?.content) throw new Error("LLM returned an empty response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(message.content);
  } catch {
    throw new Error("LLM returned invalid JSON");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`LLM response failed validation: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return result.data;
}

export function parseAnalysisMessage(message: LlmMessage): BrewAnalysis {
  return parseMessage(message, analysisSchema);
}

export async function analyzeWithLlm(context: BrewContext, hidden: ReadonlySet<AiDetail> = new Set(), custom?: PromptCustom): Promise<BrewAnalysis> {
  return (await requestAnalysis(context, hidden, custom)).analysis;
}

// The analysis plus what it cost, for the eval script (src/eval.ts).
export type Usage = { promptTokens: number; completionTokens: number } | null;
export interface AnalysisRun {
  analysis: BrewAnalysis;
  usage: Usage;
}

export async function complete(request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): Promise<{ message: LlmMessage; usage: Usage }> {
  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    completion = await openai.chat.completions.create(request);
  } catch (err) {
    // Bad key, unknown model, malformed request: retrying won't help.
    if (err instanceof OpenAI.APIError && err.status !== undefined && [400, 401, 403, 404].includes(err.status)) {
      throw new UnrecoverableError(`OpenAI rejected the request (${err.status}): ${err.message}`);
    }
    throw err; // 429 / 5xx / network: let BullMQ retry with backoff
  }
  const usage = completion.usage ? { promptTokens: completion.usage.prompt_tokens, completionTokens: completion.usage.completion_tokens } : null;
  return { message: completion.choices[0]?.message, usage };
}

export async function requestAnalysis(context: BrewContext, hidden: ReadonlySet<AiDetail> = new Set(), custom?: PromptCustom): Promise<AnalysisRun> {
  const { message, usage } = await complete(buildCompletionRequest(context, hidden, custom));
  return { analysis: onlyWhatApplies(parseAnalysisMessage(message), context, hidden), usage };
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

// ---- "Suggest parameters" (docs/api/llm-contract.md §9b) -------------------------

export const PARAMETER_SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string", description: "A concise 1-2 sentence explanation of the values." },
    nextStep: { type: "string", description: "The one thing to do or watch on this brew, in plain words (at most 140 characters)." },
    confidence: {
      type: "string",
      enum: [...ANALYSIS_CONFIDENCE],
      description: "How sure the values are: low with no comparable brews, vague notes or measurements that look wrong.",
    },
    grindSetting: { type: ["number", "null"], description: "The setting on the named grinder's dial; null without one to go on." },
    grindRpm: { type: ["integer", "null"], description: "Grinder speed for a variable-speed grinder; null otherwise." },
    tempC: { type: ["number", "null"], description: "Water temperature in Celsius." },
    ratio: {
      type: ["number", "null"],
      description: "The brew ratio for the batch: (water + ice) / dose, or for espresso shot weight / dose; null to keep the batch's.",
    },
    alternatives: {
      type: "array",
      description: "Something else to try from options, at most one of each kind; empty when there are no options or nothing stands out.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...SUGGEST_ALTERNATIVES] },
          option: { type: "string", description: "The option's ref, e.g. r2." },
          why: { type: "string", description: "Why, in plain words (at most 140 characters)." },
        },
        required: ["kind", "option", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["reasoning", "nextStep", "confidence", "grindSetting", "grindRpm", "tempC", "ratio", "alternatives"],
  additionalProperties: false,
} as const;

const suggestionSchema = z.object({
  reasoning: z.string().trim().min(1).max(2000),
  nextStep: z.string().trim().min(1).max(200),
  confidence: z.enum(ANALYSIS_CONFIDENCE),
  grindSetting: z
    .number()
    .transform((n) => Math.round(n * 100) / 100)
    .refine((n) => n >= 0 && n < 10000, "must be from 0 to 10000")
    .nullable(),
  grindRpm: z.number().int().min(50).max(5000).nullable(),
  tempC: z
    .number()
    .transform((n) => Math.round(n * 10) / 10)
    .refine((n) => n >= 0 && n <= 100, "must be from 0 to 100 °C")
    .nullable(),
  ratio: z
    .number()
    .transform((n) => Math.round(n * 100) / 100)
    .refine((n) => n > 0 && n < 1000, "must be over 0 and under 1000")
    .nullable(),
  alternatives: z.array(z.object({ kind: z.enum(SUGGEST_ALTERNATIVES), option: z.string().trim(), why: z.string().trim().min(1).max(300) })).max(10),
});
export type ParameterSuggestionResult = z.infer<typeof suggestionSchema>;

export function buildSuggestRequest(
  context: SuggestContext,
  hidden: ReadonlySet<AiDetail> = new Set(),
  custom?: PromptCustom,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const input = toSuggestInput(context, hidden);
  return {
    model: config.openaiModel,
    messages: [
      { role: "system", content: buildSystemPrompt(input, SUGGEST_SECTIONS, custom) },
      { role: "user", content: JSON.stringify(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "parameter_suggestion", strict: true, schema: PARAMETER_SUGGESTION_JSON_SCHEMA },
    },
  };
}

export function parseSuggestionMessage(message: LlmMessage): ParameterSuggestionResult {
  return parseMessage(message, suggestionSchema);
}

// Ratios a brew can sensibly use: espresso from ristretto to lungo and
// beyond; filter from a cold brew concentrate to a very light pour over.
export const RATIO_RANGE = { espresso: [0.75, 5], filter: [2, 25] } as const;

// What's saved: the alternatives as the rows they name.
export type SuggestionValues = Omit<ParameterSuggestionResult, "alternatives"> & { alternatives: SuggestedAlternative[] };

// The alternatives that name an option sent, of a kind asked, one of each
// kind (the first), with the row's id and name.
export function alternativesThatApply(given: ParameterSuggestionResult["alternatives"], options: SuggestContext["options"]): SuggestedAlternative[] {
  const named = new Map<string, { kind: AlternativeKind; id: string; name: string }>();
  for (const r of options.recipes ?? []) named.set(r.ref, { kind: "recipe", id: r.id, name: `${r.name} (${r.brewer})` });
  for (const b of options.brewers ?? []) named.set(b.ref, { kind: "brewer", id: b.id, name: b.name });
  for (const b of options.beans ?? []) named.set(b.ref, { kind: "bean", id: b.id, name: `${b.bean.roasterName} ${b.bean.beanName}` });
  const out: SuggestedAlternative[] = [];
  for (const a of given) {
    const option = named.get(a.option);
    if (!option || option.kind !== a.kind || out.some((x) => x.kind === a.kind)) continue;
    out.push({ ...option, why: a.why.slice(0, 200) });
  }
  return out;
}

// Drops the values that don't fit the brew being set up, whatever the model said.
export function onlySuggestionsThatApply(s: ParameterSuggestionResult, context: SuggestContext, hidden: ReadonlySet<AiDetail>): SuggestionValues {
  const out: SuggestionValues = { ...s, alternatives: alternativesThatApply(s.alternatives, context.options) };
  const g = context.grinder;
  // A setting only means something on the grinder chosen, within its dial.
  const offDial = out.grindSetting !== null && g !== null && ((g.settingMin !== null && out.grindSetting < g.settingMin) || (g.settingMax !== null && out.grindSetting > g.settingMax));
  if (!g || offDial) out.grindSetting = null;
  if (!g?.variableSpeed || hidden.has("rpm")) out.grindRpm = null;
  if (hidden.has("temp")) out.tempC = null;
  // A ratio outside what the method brews at is a slip (e.g. 1:2 for a pour
  // over), as is the batch's own: either way the batch keeps its ratio.
  const espresso = (context.recipe?.methodKind ?? context.brewer?.kind) === "espresso";
  const [min, max] = espresso ? RATIO_RANGE.espresso : RATIO_RANGE.filter;
  if (out.ratio !== null && (out.ratio < min || out.ratio > max || out.ratio === context.batch.ratio)) out.ratio = null;
  return out;
}

export interface SuggestionRun {
  suggestion: SuggestionValues;
  usage: Usage;
}
export async function requestSuggestion(context: SuggestContext, hidden: ReadonlySet<AiDetail> = new Set(), custom?: PromptCustom): Promise<SuggestionRun> {
  const { message, usage } = await complete(buildSuggestRequest(context, hidden, custom));
  return { suggestion: onlySuggestionsThatApply(parseSuggestionMessage(message), context, hidden), usage };
}
