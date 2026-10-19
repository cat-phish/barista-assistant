import { describe, expect, it } from "vitest";
import type { BrewContext } from "../src/context.js";
import { buildCompletionRequest, parseAnalysisMessage, SYSTEM_PROMPT } from "../src/llm.js";

const reply = (body: unknown) => ({ content: JSON.stringify(body), refusal: null });
const valid = { reasoning: "Under-extracted.", suggestedGrindDelta: "finer", suggestedTempDelta: 1 };

describe("parseAnalysisMessage", () => {
  it("accepts a valid reply", () => {
    expect(parseAnalysisMessage(reply(valid))).toEqual(valid);
  });

  it("rounds the temperature change to the column's 1 decimal", () => {
    expect(parseAnalysisMessage(reply({ ...valid, suggestedTempDelta: 1.25 })).suggestedTempDelta).toBe(1.3);
    expect(parseAnalysisMessage(reply({ ...valid, suggestedTempDelta: -0.04 })).suggestedTempDelta).toBe(-0);
  });

  it.each([
    ["temperature change over 10 °C", reply({ ...valid, suggestedTempDelta: 25 }), /within ±10/],
    ["unknown grind direction", reply({ ...valid, suggestedGrindDelta: "a_bit_finer" }), /suggestedGrindDelta/],
    ["empty reasoning", reply({ ...valid, reasoning: "  " }), /reasoning/],
    ["missing field", reply({ reasoning: "x", suggestedGrindDelta: "finer" }), /suggestedTempDelta/],
    ["refusal", { content: null, refusal: "I can't help" }, /refused/],
    ["empty reply", { content: "", refusal: null }, /empty/],
    ["no message at all", undefined, /empty/],
    ["invalid JSON", { content: "{not json", refusal: null }, /invalid JSON/],
  ])("rejects %s (so BullMQ retries)", (_label, message, error) => {
    expect(() => parseAnalysisMessage(message)).toThrow(error);
  });
});

describe("buildCompletionRequest", () => {
  it("matches the §9 contract: system prompt, strict schema, no $schema key", () => {
    const context = { brew: { tastingNotes: "sour" } } as unknown as BrewContext;
    const req = buildCompletionRequest(context);
    expect(req.model).toBe("test-model"); // from OPENAI_MODEL
    expect(req.messages[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(JSON.parse(String(req.messages[1]?.content))).toEqual(context);
    expect(req.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "brew_analysis", strict: true } });
    const schema = (req.response_format as { json_schema: { schema: Record<string, unknown> } }).json_schema.schema;
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ["reasoning", "suggestedGrindDelta", "suggestedTempDelta"],
      properties: { suggestedGrindDelta: { enum: ["much_finer", "finer", "no_change", "coarser", "much_coarser"] } },
    });
  });
});
