import Anthropic from "@anthropic-ai/sdk";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { completeWithAnthropic, respondWithAnthropic, toAnthropicRequest, toLlmMessage, visitedIn } from "../src/ai/anthropic.js";
import type { AnthropicAi } from "../src/ai/client.js";
import { buildLabelRequest } from "../src/label.js";
import { buildWebRequest } from "../src/labelWeb.js";

const usage = { input_tokens: 3, output_tokens: 4 };
function fakeAi(replies: unknown[], official = false): { ai: AnthropicAi; create: ReturnType<typeof vi.fn>; beta: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  const beta = vi.fn();
  for (const r of replies) {
    if (r instanceof Error) (official ? beta : create).mockRejectedValueOnce(r);
    else (official ? beta : create).mockResolvedValueOnce(r);
  }
  const anthropic = { messages: { create }, beta: { messages: { create: beta } } } as unknown as Anthropic;
  return { ai: { provider: "anthropic", apiKey: "sk-ant-secret", models: { main: "claude-x", vision: "claude-x", web: "claude-x" }, official, anthropic }, create, beta };
}
const chat = { model: "claude-x", messages: [{ role: "system" as const, content: "S" }, { role: "user" as const, content: "U" }], response_format: { type: "json_schema" as const, json_schema: { name: "n", strict: true, schema: { type: "object" } } } };

describe("toAnthropicRequest", () => {
  it("moves the system prompt and the schema", () => {
    expect(toAnthropicRequest(chat)).toEqual({ model: "claude-x", max_tokens: 16000, system: "S", messages: [{ role: "user", content: "U" }], output_config: { format: { type: "json_schema", schema: { type: "object" } } } });
  });

  it("sends a label's photos as base64 images", () => {
    const request = toAnthropicRequest(buildLabelRequest("claude-x", { images: ["AAA"], processes: [], requestedBy: "u" }));
    const content = request.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({ type: "text" });
    expect(content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/webp", data: "AAA" } });
  });
});

describe("completeWithAnthropic", () => {
  it("returns the text and usage", async () => {
    const { ai } = fakeAi([{ content: [{ type: "thinking", thinking: "" }, { type: "text", text: "{}" }], stop_reason: "end_turn", usage }]);
    expect(await completeWithAnthropic(ai, chat)).toEqual({ message: { content: "{}", refusal: null }, usage: { promptTokens: 3, completionTokens: 4 } });
  });

  it("turns a refusal into the same refusal as OpenAI's", () => {
    expect(toLlmMessage({ content: [], stop_reason: "refusal", usage } as never)?.refusal).toBeTruthy();
  });

  it("asks for fallbacks only for models that have them, on Anthropic's own API", async () => {
    const reply = { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage };
    const official = fakeAi([reply], true);
    await completeWithAnthropic(official.ai, { ...chat, model: "claude-opus-5-5" });
    expect(official.beta.mock.calls[0]![0]).toMatchObject({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    const other = fakeAi([reply]);
    await completeWithAnthropic(other.ai, { ...chat, model: "claude-opus-5-5" });
    expect(other.create).toHaveBeenCalledOnce();
  });

  it("doesn't retry a rejected request, and keeps the key out of the message", async () => {
    const { ai } = fakeAi([new Anthropic.APIError(401, undefined, "bad key sk-ant-secret", new Headers())]);
    const failure = await completeWithAnthropic(ai, chat).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnrecoverableError);
    expect((failure as Error).message).toContain("[key]");
    expect((failure as Error).message).not.toContain("sk-ant-secret");
  });

  it("lets a rate limit be retried", async () => {
    const { ai } = fakeAi([new Anthropic.APIError(429, undefined, "slow down", new Headers())]);
    const failure = await completeWithAnthropic(ai, chat).catch((e: unknown) => e);
    expect(failure).not.toBeInstanceOf(UnrecoverableError);
  });
});

describe("respondWithAnthropic", () => {
  const LABEL = { roasterName: "Onyx", website: "https://onyxcoffeelab.com/" } as never;
  const request = buildWebRequest("claude-x", LABEL, { images: [], processes: [], requestedBy: "u" });
  const result = { type: "web_search_tool_result", content: [{ url: "https://onyxcoffeelab.com/a" }] };
  const cited = { type: "text", text: "Notes", citations: [{ type: "web_search_result_location", url: "https://onyxcoffeelab.com/b" }] };

  it("searches its site, then fills in the schema from what it found", async () => {
    const { ai, create } = fakeAi([
      { content: [result, cited], stop_reason: "end_turn", usage },
      { content: [{ type: "text", text: '{"producer":null}' }], stop_reason: "end_turn", usage },
    ]);
    expect(await respondWithAnthropic(ai, request)).toEqual({ text: '{"producer":null}', refusal: null, visited: ["https://onyxcoffeelab.com/a", "https://onyxcoffeelab.com/b"] });
    const [search, fill] = create.mock.calls.map((c) => c[0]);
    expect(search.tools[0]).toMatchObject({ type: "web_search_20260209", allowed_domains: ["onyxcoffeelab.com"] });
    expect(search.output_config).toBeUndefined();
    expect(fill.tools).toBeUndefined();
    expect(fill.output_config.format.type).toBe("json_schema");
    expect(fill.messages[0].content).toContain("https://onyxcoffeelab.com/b");
  });

  it("resumes a paused search without a new user message", async () => {
    const { ai, create } = fakeAi([
      { content: [result], stop_reason: "pause_turn", usage },
      { content: [cited], stop_reason: "end_turn", usage },
      { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage },
    ]);
    const reply = await respondWithAnthropic(ai, request);
    expect(reply.visited).toHaveLength(2);
    expect(create.mock.calls[1]![0].messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("ignores a failed search's error object", () => {
    expect(visitedIn([{ type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "unavailable" } } as never])).toEqual([]);
  });
});
