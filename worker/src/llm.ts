import { GRIND_DELTAS } from "@barista/shared/jobs";
import { UnrecoverableError } from "bullmq";
import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";
import type { BrewContext } from "./context.js";

// System prompt and JSON schema are fixed by docs/api/llm-contract.md §9.
export const SYSTEM_PROMPT =
  "You are an expert specialty coffee roaster and barista. Analyze the provided " +
  "extraction log and historical brews for this coffee bean, including roast " +
  "level, roast age, dose, yield, total brew time, rating, and tasting notes. Suggest " +
  "concrete parameter adjustments for the next brew. rating and tastingNotes " +
  "describe the coffee tasted on its own; drinkRating and drinkTastingNotes " +
  "describe the finished drink. Milk and syrup mask acidity and bitterness and " +
  "add sweetness, so treat drink notes as weaker evidence of extraction than " +
  "straight notes, and compare a brew mainly with earlier brews served the " +
  "same way (each brew's drink says how). Judge a brew against its recipe's " +
  "style (its name is the bar's own; brewsLike says how it brews, so a " +
  "custom 'Inverted' style that brews like immersion is an immersion brew): a soup shot is a long, high-ratio espresso on purpose, a cold brew " +
  "steeps cold for hours, and an immersion brew isn't a pour over. A " +
  "stovetop brew (moka pot, ibrik) is a strong, short brew judged on its own " +
  "terms, not as espresso; an 'other' method is described by its style and " +
  "the notes. The " +
  "bean's roastType says what the roaster roasted it for: an espresso roast " +
  "brewed as filter (or the reverse) may need a different approach rather " +
  "than small corrections. Decaf and blends often extract differently from " +
  "single origins. The flavorProfile is the roaster's description of the cup " +
  "to aim for, and a higher altitudeMasl usually means denser beans that take " +
  "a finer grind or hotter water. The origin (originArea, country, region) " +
  "hints at the bean's typical character, e.g. many East African coffees are " +
  "dense and bright while Brazilian ones are often lower grown and softer; " +
  "treat it as context, not a rule. When tdsPercent is given, use it and " +
  "extractionYieldPercent to judge strength and extraction rather than " +
  "guessing from taste alone: filter usually lands around 1.15-1.45% TDS and " +
  "espresso 8-12%, both often 18-22% extraction, but the taste and the " +
  "roaster's intent come first. A brew's water (mg/L, GH and KH as CaCO3) " +
  "matters too: harder water with more magnesium and calcium tends to " +
  "extract more, while high alkalinity (KH) buffers acidity and can flatten " +
  "the cup; only the figures given are known. prepTools lists the prep used " +
  "(WDT, puck screen, filter type…); an empty list means none was recorded, " +
  "not that none was used, so only compare tools between brews that list " +
  "them. For " +
  "espresso, judge flow " +
  "from the first drop time, shot time and ratio against the recipe's " +
  "windows, and consider the machine's capabilities (pre-infusion, flow and " +
  "pressure control) and the grinder's step size when explaining the change. " +
  "Respond strictly matching the provided JSON schema.";

export const BREW_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description: "A concise 1-2 sentence diagnosis of extraction quality and why adjustments are needed.",
    },
    suggestedGrindDelta: {
      type: "string",
      enum: [...GRIND_DELTAS],
    },
    suggestedTempDelta: {
      type: "number",
      description: "Suggested change in Celsius (e.g., -1.5, 0, 2.0).",
    },
  },
  required: ["reasoning", "suggestedGrindDelta", "suggestedTempDelta"],
  additionalProperties: false,
} as const;

const MAX_TEMP_DELTA_C = 10;

// Strict mode should guarantee the shape; validate anyway (§9). Temp delta is
// rounded to the column's 1 decimal; out-of-range values fail the attempt.
const analysisSchema = z.object({
  reasoning: z.string().trim().min(1).max(2000),
  suggestedGrindDelta: z.enum(GRIND_DELTAS),
  suggestedTempDelta: z
    .number()
    .transform((n) => Math.round(n * 10) / 10)
    .refine((n) => Math.abs(n) <= MAX_TEMP_DELTA_C, `must be within ±${MAX_TEMP_DELTA_C} °C`),
});

export type BrewAnalysis = z.infer<typeof analysisSchema>;

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// The exact request sent to OpenAI (pure, so tests can check it against §9).
export function buildCompletionRequest(context: BrewContext): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  return {
    model: config.openaiModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(context) },
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

export async function analyzeWithLlm(context: BrewContext): Promise<BrewAnalysis> {
  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    completion = await openai.chat.completions.create(buildCompletionRequest(context));
  } catch (err) {
    // Bad key, unknown model, malformed request: retrying won't help.
    if (err instanceof OpenAI.APIError && err.status !== undefined && [400, 401, 403, 404].includes(err.status)) {
      throw new UnrecoverableError(`OpenAI rejected the request (${err.status}): ${err.message}`);
    }
    throw err; // 429 / 5xx / network: let BullMQ retry with backoff
  }
  return parseAnalysisMessage(completion.choices[0]?.message);
}
