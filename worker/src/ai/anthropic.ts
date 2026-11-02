import Anthropic from "@anthropic-ai/sdk";
import { UnrecoverableError } from "bullmq";
import type OpenAI from "openai";
import type { LlmMessage, Usage, WebReply } from "../llm.js";
import { withoutKey, type AnthropicAi } from "./client.js";

// Claude's own API behind what the jobs already build: their requests stay
// OpenAI-shaped (buildCompletionRequest and the rest) and are translated
// here, so the prompts, the saved request and the snapshot tests don't care
// who answers. No thinking or effort settings: the model is the person's
// choice, and which of those it takes varies.
type ChatRequest = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type MediaType = Anthropic.Base64ImageSource["media_type"];

const MAX_TOKENS = 16000;
// Resuming a paused web search: enough for any lookup, and never endless.
const MAX_PAUSES = 5;
// These accept fallbacks on a refusal, on Anthropic's own API.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const textOf = (content: unknown): string => (typeof content === "string" ? content : "");

function imageBlock(url: string): Anthropic.ImageBlockParam {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(url);
  if (!match) throw new UnrecoverableError("Only inline images can be sent");
  return { type: "image", source: { type: "base64", media_type: match[1] as MediaType, data: match[2]! } };
}

function userContent(content: OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"]): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  return content.map((part): Anthropic.ContentBlockParam => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "image_url") return imageBlock(part.image_url.url);
    throw new UnrecoverableError(`Can't send a ${part.type} part`);
  });
}

function outputFormat(schema: unknown): Anthropic.OutputConfig {
  return { format: { type: "json_schema", schema: schema as Anthropic.JSONOutputFormat["schema"] } };
}

// Pure, so tests can check it.
export function toAnthropicRequest(request: ChatRequest): Anthropic.MessageCreateParamsNonStreaming {
  const system = request.messages.find((m) => m.role === "system");
  const format = request.response_format;
  return {
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: textOf(system?.content),
    messages: request.messages.flatMap((m): Anthropic.MessageParam[] => {
      if (m.role === "user") return [{ role: "user", content: userContent(m.content) }];
      if (m.role === "assistant") return [{ role: "assistant", content: textOf(m.content) }];
      return [];
    }),
    ...(format?.type === "json_schema" ? { output_config: outputFormat(format.json_schema.schema) } : {}),
  };
}

// As complete() does for OpenAI: a bad key, unknown model or malformed
// request won't be helped by retrying; 429, 5xx and the network will.
function rethrow(err: unknown, ai: AnthropicAi): never {
  if (err instanceof Anthropic.APIError && err.status !== undefined && [400, 401, 403, 404].includes(err.status)) {
    throw new UnrecoverableError(withoutKey(`Anthropic rejected the request (${err.status}): ${err.message}`, ai.apiKey));
  }
  if (err instanceof Error) err.message = withoutKey(err.message, ai.apiKey);
  throw err;
}

type Reply = Pick<Anthropic.Message, "content" | "stop_reason" | "usage">;

async function send(ai: AnthropicAi, params: Anthropic.MessageCreateParamsNonStreaming): Promise<Reply> {
  try {
    if (ai.official && FALLBACK_MODELS.has(params.model)) {
      return (await ai.anthropic.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming)) as unknown as Reply;
    }
    return await ai.anthropic.messages.create(params);
  } catch (err) {
    rethrow(err, ai);
  }
}

const textIn = (reply: Reply): string => reply.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

export function toLlmMessage(reply: Reply): LlmMessage {
  if (reply.stop_reason === "refusal") return { content: null, refusal: "The model declined to answer" };
  return { content: textIn(reply), refusal: null };
}

export async function completeWithAnthropic(ai: AnthropicAi, request: ChatRequest): Promise<{ message: LlmMessage; usage: Usage }> {
  const reply = await send(ai, toAnthropicRequest(request));
  return { message: toLlmMessage(reply), usage: { promptTokens: reply.usage.input_tokens, completionTokens: reply.usage.output_tokens } };
}

// A chat reply (docs/api/llm-contract.md §9e), each piece as it's written. No
// fallbacks: switching model part way would restart text already shown.
export async function streamWithAnthropic(ai: AnthropicAi, request: ChatRequest, onText: (text: string) => void): Promise<{ refusal: string | null; usage: Usage }> {
  try {
    const stream = ai.anthropic.messages.stream(toAnthropicRequest(request));
    stream.on("text", onText);
    const reply = await stream.finalMessage();
    return { refusal: toLlmMessage(reply)?.refusal ?? null, usage: { promptTokens: reply.usage.input_tokens, completionTokens: reply.usage.output_tokens } };
  } catch (err) {
    rethrow(err, ai);
  }
}

// Every address a search found or the answer cited.
export function visitedIn(content: readonly Anthropic.ContentBlock[]): string[] {
  const visited: string[] = [];
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      visited.push(...block.content.map((r) => r.url));
    } else if (block.type === "text") {
      for (const c of block.citations ?? []) if (c.type === "web_search_result_location") visited.push(c.url);
    }
  }
  return visited;
}

interface WebFormat {
  schema: unknown;
}
const webFormat = (request: OpenAI.Responses.ResponseCreateParamsNonStreaming): WebFormat => {
  const format = request.text?.format;
  if (format?.type !== "json_schema") throw new UnrecoverableError("The web lookup needs a schema");
  return format;
};
const allowedDomains = (request: OpenAI.Responses.ResponseCreateParamsNonStreaming): string[] | undefined => {
  for (const tool of request.tools ?? []) if (tool.type === "web_search") return tool.filters?.allowed_domains ?? undefined;
  return undefined;
};

// Two calls: Claude can't return a schema along with the citations a web
// search brings, so it searches and writes what it found, then a second call
// puts that into the schema. search_context_size has no equivalent.
export async function respondWithAnthropic(ai: AnthropicAi, request: OpenAI.Responses.ResponseCreateParamsNonStreaming): Promise<WebReply> {
  const system = request.instructions ?? "";
  const input = String(request.input ?? "");
  const domains = allowedDomains(request);
  const tool: Anthropic.WebSearchTool20260209 = { type: "web_search_20260209", name: "web_search", ...(domains ? { allowed_domains: domains } : {}) };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: input }];
  const found: Anthropic.ContentBlock[] = [];
  let reply = await send(ai, { model: request.model!, max_tokens: MAX_TOKENS, system, messages, tools: [tool] });
  found.push(...reply.content);
  for (let pauses = 0; reply.stop_reason === "pause_turn" && pauses < MAX_PAUSES; pauses++) {
    reply = await send(ai, { model: request.model!, max_tokens: MAX_TOKENS, system, messages: [...messages, { role: "assistant", content: reply.content }], tools: [tool] });
    found.push(...reply.content);
  }
  const visited = visitedIn(found);
  if (reply.stop_reason === "refusal") return { text: "", refusal: "The model declined to answer", visited };

  const notes = found.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  const answer = await send(ai, {
    model: request.model!,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: `${input}\n\nWhat the search found, with its pages: ${notes}\nPages seen: ${visited.join(" ")}` }],
    output_config: outputFormat(webFormat(request).schema),
  });
  const message = toLlmMessage(answer);
  return { text: message?.content ?? "", refusal: message?.refusal ?? null, visited };
}

export async function listAnthropicModels(ai: AnthropicAi): Promise<string[]> {
  const ids: string[] = [];
  try {
    for await (const model of ai.anthropic.models.list()) ids.push(model.id);
  } catch (err) {
    rethrow(err, ai);
  }
  return ids;
}
