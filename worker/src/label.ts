// Reading a bean's label from its photos (docs/api/llm-contract.md §9c): the
// photos go to a vision model with a fixed prompt, and the answer is the bean
// fields it could read. Nothing is stored; the backend waits for the result.
// The asker's own prompt applies (docs/api/auth.md §1c): their text for the
// labelCore section and their label instructions, not their brewing ones.
import { EMPTY_AI_PROMPT, LABEL_INSTRUCTIONS_INTRO, PROMPT_TEXT, type AiPrompt } from "@barista/shared/aiPrompt";
import type { LabelFields, LabelReadJobData, LabelReadResult } from "@barista/shared/jobs";
import { BLEND_TYPES, DETAILED_ROAST_LEVELS, ROAST_LEVELS, ROAST_TYPES } from "@barista/shared/schema";
import type OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";
import { complete, parseMessage, type LlmMessage } from "./llm.js";
import { lookUpBean } from "./labelWeb.js";
import { promptFor } from "./processor.js";

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const text = nullable({ type: "string" });

// The answer's shape; processName may only be one of this workspace's processes.
export function labelJsonSchema(processes: readonly string[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    roasterName: text,
    beanName: text,
    processName: processes.length ? nullable({ type: "string", enum: [...processes] }) : { type: "null" },
    processText: text,
    country: text,
    region: text,
    producer: text,
    altitudeMasl: nullable({ type: "integer" }),
    flavorProfile: text,
    roastDate: text,
    detailedRoastLevel: nullable({ type: "string", enum: [...DETAILED_ROAST_LEVELS] }),
    roastLevel: nullable({ type: "string", enum: [...ROAST_LEVELS] }),
    roastType: nullable({ type: "string", enum: [...ROAST_TYPES] }),
    blendType: nullable({ type: "string", enum: [...BLEND_TYPES] }),
    decaf: nullable({ type: "boolean" }),
    bagWeightGrams: nullable({ type: "integer" }),
    batchNumber: text,
    website: text,
  };
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

// The system prompt: labelCore (theirs or the default), their label
// instructions, then the locked end section.
export function labelSystemPrompt(prompt: AiPrompt = EMPTY_AI_PROMPT): string {
  const parts = [prompt.overrides.labelCore || PROMPT_TEXT.labelCore!];
  if (prompt.labelInstructions) parts.push(`${LABEL_INSTRUCTIONS_INTRO} ${prompt.labelInstructions}`);
  parts.push(PROMPT_TEXT.end!);
  return parts.join(" ");
}

export function buildLabelRequest(data: LabelReadJobData, prompt: AiPrompt = EMPTY_AI_PROMPT): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const processes = data.processes.length ? data.processes.join(", ") : "none";
  return {
    model: config.openaiVisionModel,
    messages: [
      { role: "system", content: labelSystemPrompt(prompt) },
      {
        role: "user",
        content: [
          { type: "text", text: `${data.images.length} photo(s) of one bag. Processes to choose from: ${processes}.` },
          ...data.images.map((b64) => ({ type: "image_url" as const, image_url: { url: `data:image/webp;base64,${b64}`, detail: "high" as const } })),
        ],
      },
    ],
    response_format: { type: "json_schema", json_schema: { name: "bean_label", strict: true, schema: labelJsonSchema(data.processes) } },
  };
}

// Each value is checked on its own: one the bean form wouldn't take becomes
// null rather than failing the whole answer (limits as in beans.ts).
const clean = (max: number) =>
  z
    .string()
    .nullable()
    .transform((s) => {
      const t = s?.trim().replace(/\s+/g, " ") ?? "";
      return t && t.length <= max ? t : null;
    })
    .catch(null);
const oneOf = <T extends string>(values: readonly T[]) => z.enum(values as [T, ...T[]]).nullable().catch(null);
const whole = (min: number, max: number) => z.number().int().min(min).max(max).nullable().catch(null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// A real date, from 2000 up to tomorrow (a roast date can't be later).
const roastDate = z
  .string()
  .nullable()
  .transform((s) => {
    if (!s || !DAY.test(s)) return null;
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
    return s >= "2000-01-01" && d.getTime() <= Date.now() + 86_400_000 ? s : null;
  })
  .catch(null);
const website = z
  .string()
  .nullable()
  .transform((s) => {
    const t = s?.trim() ?? "";
    if (!t) return null;
    try {
      const url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".") && url.href.length <= 500 ? url.href : null;
    } catch {
      return null;
    }
  })
  .catch(null);

export function labelSchema(processes: readonly string[]) {
  return z.object({
    roasterName: clean(255),
    beanName: clean(255),
    processName: z
      .string()
      .nullable()
      .transform((s) => (s && processes.includes(s) ? s : null))
      .catch(null),
    processText: clean(100),
    country: clean(100),
    region: clean(255),
    producer: clean(255),
    altitudeMasl: whole(1, 9000),
    flavorProfile: clean(500),
    roastDate,
    detailedRoastLevel: oneOf(DETAILED_ROAST_LEVELS),
    roastLevel: oneOf(ROAST_LEVELS),
    roastType: oneOf(ROAST_TYPES),
    blendType: oneOf(BLEND_TYPES),
    decaf: z
      .boolean()
      .nullable()
      .transform((d) => (d === true ? true : null))
      .catch(null),
    bagWeightGrams: whole(1, 100_000),
    batchNumber: clean(50),
    website,
  });
}

export function parseLabelMessage(message: LlmMessage, processes: readonly string[]): LabelFields {
  const fields = parseMessage(message, labelSchema(processes));
  // A process that matched isn't repeated as text.
  return { ...fields, processText: fields.processName ? null : fields.processText };
}

// The label, then (when asked) the web lookup. A failed lookup still
// returns what the label says, with webError for the person.
export async function readLabel(data: LabelReadJobData): Promise<LabelReadResult> {
  const { prompt } = await promptFor(data.requestedBy, null);
  const { message } = await complete(buildLabelRequest(data, prompt));
  const fields = parseLabelMessage(message, data.processes);
  if (!data.web) return { fields, web: null, webError: null };
  try {
    return { fields, web: await lookUpBean(fields, data, prompt), webError: null };
  } catch (err) {
    console.error("Web lookup failed:", err instanceof Error ? err.message : err);
    return { fields, web: null, webError: "The web lookup didn't work (the AI provider or model may not support web search). The label was still read." };
  }
}
