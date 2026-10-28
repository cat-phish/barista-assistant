// Reading a bean's label from its photos (docs/api/llm-contract.md §9c): the
// photos go to a vision model with a fixed prompt, and the answer is the bean
// fields it could read. Nothing is stored; the backend waits for the result.
// Not part of "Your AI prompt": it's reading, not judging.
import type { LabelFields, LabelReadJobData } from "@barista/shared/jobs";
import { BLEND_TYPES, DETAILED_ROAST_LEVELS, ROAST_LEVELS, ROAST_TYPES } from "@barista/shared/schema";
import type OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";
import { complete, parseMessage, type LlmMessage } from "./llm.js";

export const LABEL_PROMPT = [
  "You read the label of a bag of roasted coffee from photos (front, back, a card), to fill in a form about the coffee.",
  "Fill a field only with what is printed or clearly shown; null when it isn't there or can't be read. Never guess or",
  "fill from general knowledge. roasterName is the roaster's name; beanName the coffee's name (often the farm, region or",
  "blend name), without the roaster. processName is one of the given processes when the printed process is one of them",
  "(e.g. 'Natural' for 'Dry process'); otherwise null, with the process as printed in processText. country is in English",
  "(e.g. 'Ethiopia'); region the area within it. altitudeMasl is in metres above sea level: a range gives its middle,",
  "feet are converted. flavorProfile is the tasting notes as printed, comma-separated. roastDate is the date it was",
  "roasted, as YYYY-MM-DD; a best-before or packed-on date is not a roast date. detailedRoastLevel is a named roast",
  "(City, Full City…) when one is printed; roastLevel only when just light, medium-light, medium, medium-dark or dark",
  "is. roastType is filter, espresso or omni when the bag says what it's roasted for. blendType is blend when it says",
  "blend, single_origin when it names one origin as such. decaf is true only when it says decaf. bagWeightGrams is the",
  "net weight in grams (12 oz = 340). batchNumber is a roast batch or lot number. website is the roaster's web address",
  "with https://.",
].join(" ");

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

export function buildLabelRequest(data: LabelReadJobData): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const processes = data.processes.length ? data.processes.join(", ") : "none";
  return {
    model: config.openaiVisionModel,
    messages: [
      { role: "system", content: LABEL_PROMPT },
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

export async function readLabel(data: LabelReadJobData): Promise<LabelFields> {
  const { message } = await complete(buildLabelRequest(data));
  return parseLabelMessage(message, data.processes);
}
