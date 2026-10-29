// Looking a bean up on the web (docs/api/llm-contract.md §9c, step 2): after
// the label is read, its text (never the photos) goes to a model with the
// web search tool, limited to the roaster's site when its address is known.
// Each value comes with the page it's from, and is kept only when that page
// is one the search really visited (and on the roaster's site, if limited).
import { EMPTY_AI_PROMPT, LABEL_INSTRUCTIONS_INTRO, PROMPT_TEXT, type AiPrompt } from "@barista/shared/aiPrompt";
import { LABEL_WEB_FIELDS, type LabelFields, type LabelReadJobData, type LabelWebFinds } from "@barista/shared/jobs";
import type OpenAI from "openai";
import { config } from "./config.js";
import { labelJsonSchema, labelSchema } from "./label.js";
import { respond, type WebReply } from "./llm.js";

// "https://www.onyxcoffeelab.com/x" → "onyxcoffeelab.com"; null if not a web address.
export function hostOf(address: string | null | undefined): string | null {
  if (!address) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}
const onSite = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

// The answer: each field null, or { value, url }; value as the label's schema has it.
export function labelWebJsonSchema(processes: readonly string[]): Record<string, unknown> {
  const label = labelJsonSchema(processes) as { properties: Record<string, { anyOf?: unknown[] }> };
  const properties = Object.fromEntries(
    LABEL_WEB_FIELDS.map((field) => {
      const value = label.properties[field]!;
      // Not nullable inside: a value that isn't there is the whole field null.
      const inner = value.anyOf ? value.anyOf[0] : value;
      return [
        field,
        {
          anyOf: [
            { type: "object", additionalProperties: false, required: ["value", "url"], properties: { value: inner, url: { type: "string" } } },
            { type: "null" },
          ],
        },
      ];
    }),
  );
  return { type: "object", additionalProperties: false, required: [...LABEL_WEB_FIELDS], properties };
}

export function webSystemPrompt(prompt: AiPrompt = EMPTY_AI_PROMPT): string {
  const parts = [prompt.overrides.labelWeb || PROMPT_TEXT.labelWeb!];
  if (prompt.labelInstructions) parts.push(`${LABEL_INSTRUCTIONS_INTRO} ${prompt.labelInstructions}`);
  parts.push(PROMPT_TEXT.end!);
  return parts.join(" ");
}

// The site to keep to: the website the label gave, else the form's.
export const siteFor = (fields: LabelFields, data: LabelReadJobData): string | null => hostOf(fields.website) ?? hostOf(data.website);

export function buildWebRequest(fields: LabelFields, data: LabelReadJobData, prompt: AiPrompt = EMPTY_AI_PROMPT): OpenAI.Responses.ResponseCreateParamsNonStreaming {
  const site = siteFor(fields, data);
  // What the label says, without what belongs to one bag.
  const { roastDate: _date, batchNumber: _batch, ...label } = fields;
  const known = Object.fromEntries(Object.entries(label).filter(([, v]) => v !== null));
  const processes = data.processes.length ? data.processes.join(", ") : "none";
  return {
    model: config.openaiWebModel,
    instructions: webSystemPrompt(prompt),
    input:
      `The label says: ${JSON.stringify(known)}. Processes to choose from: ${processes}.` +
      (site ? ` Search only the roaster's site, ${site}, for this coffee's own product page.` : " Look for the roaster's own product page for this coffee."),
    // How much of each page is read: the workspace's labelWebContext.
    tools: [{ type: "web_search", search_context_size: data.webContext ?? "high", ...(site ? { filters: { allowed_domains: [site] } } : {}) }],
    include: ["web_search_call.action.sources"],
    text: { format: { type: "json_schema", name: "bean_web", strict: true, schema: labelWebJsonSchema(data.processes) } },
  };
}

// Each value checked as a label value is; the page must be one the search
// visited, and on the roaster's site when the search was limited to it.
export function parseWebReply(reply: WebReply, processes: readonly string[], site: string | null): LabelWebFinds {
  if (reply.refusal) throw new Error(`LLM refused: ${reply.refusal}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.text);
  } catch {
    throw new Error("LLM returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("LLM returned invalid JSON");
  const visited = new Set(reply.visited.map(hostOf).filter((h): h is string => h !== null));
  const shape = labelSchema(processes).shape;
  const finds: Record<string, { value: unknown; url: string }> = {};
  for (const field of LABEL_WEB_FIELDS) {
    const found = (parsed as Record<string, unknown>)[field];
    if (typeof found !== "object" || found === null) continue;
    const { value, url } = found as { value?: unknown; url?: unknown };
    const host = typeof url === "string" ? hostOf(url) : null;
    if (!host || !/^https?:\/\//i.test(url as string) || !visited.has(host) || (site && !onSite(host, site))) continue;
    const checked: unknown = shape[field].parse(value ?? null);
    if (checked !== null) finds[field] = { value: checked, url: url as string };
  }
  // A process that matched isn't repeated as text.
  if (finds.processName) delete finds.processText;
  return finds as LabelWebFinds;
}

export async function lookUpBean(fields: LabelFields, data: LabelReadJobData, prompt: AiPrompt): Promise<LabelWebFinds> {
  return parseWebReply(await respond(buildWebRequest(fields, data, prompt)), data.processes, siteFor(fields, data));
}
