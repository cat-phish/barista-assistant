import { LABEL_WEB_FIELDS } from "@barista/shared/jobs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// readLabel with the AI calls stood in: the label, then the web lookup.
const complete = vi.fn();
const respond = vi.fn();
vi.mock("../src/llm.js", async (original) => ({ ...(await original<typeof import("../src/llm.js")>()), complete, respond }));
vi.mock("../src/processor.js", () => ({ promptFor: async () => ({ prompt: { instructions: null, overrides: {} }, note: null }) }));
const { readLabel } = await import("../src/label.js");

const label = { roasterName: "Onyx", beanName: "Geometry", processName: null, processText: null, country: null, region: null, producer: null, altitudeMasl: null, flavorProfile: null, roastDate: null, detailedRoastLevel: null, roastLevel: null, roastType: null, blendType: null, decaf: null, bagWeightGrams: null, batchNumber: null, website: "https://onyxcoffeelab.com/" };
const data = { images: ["AAA"], processes: ["Washed"], requestedBy: "u" };

beforeEach(() => {
  complete.mockReset().mockResolvedValue({ message: { content: JSON.stringify(label), refusal: null }, usage: null });
  respond.mockReset();
});

describe("readLabel (docs/api/llm-contract.md §9c)", () => {
  it("only looks it up when asked", async () => {
    expect(await readLabel(data)).toEqual({ fields: label, web: null, webError: null });
    expect(respond).not.toHaveBeenCalled();
    const page = "https://onyxcoffeelab.com/products/geometry";
    respond.mockResolvedValue({ text: JSON.stringify({ ...Object.fromEntries(LABEL_WEB_FIELDS.map((f) => [f, null])), producer: { value: "Many farms", url: page } }), refusal: null, visited: [page] });
    expect(await readLabel({ ...data, web: true })).toEqual({ fields: label, web: { producer: { value: "Many farms", url: page } }, webError: null });
  });

  it("a failed lookup still gives the label", async () => {
    respond.mockRejectedValue(new Error("web_search is not supported"));
    const result = await readLabel({ ...data, web: true });
    expect(result.fields).toEqual(label);
    expect(result.web).toBeNull();
    expect(result.webError).toMatch(/didn't work/);
  });
});
