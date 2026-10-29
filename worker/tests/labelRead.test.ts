import { LABEL_WEB_FIELDS } from "@barista/shared/jobs";
import { UnrecoverableError } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// readLabel with the AI calls stood in: the label, then the web lookup.
const complete = vi.fn();
const respond = vi.fn();
vi.mock("../src/llm.js", async (original) => ({ ...(await original<typeof import("../src/llm.js")>()), complete, respond }));
vi.mock("../src/processor.js", () => ({ promptFor: async () => ({ prompt: { instructions: null, overrides: {} }, note: null }) }));
const { readLabel } = await import("../src/label.js");

const label = { roasterName: "Onyx", beanName: "Geometry", processName: null, processText: null, country: null, region: null, producer: null, altitudeMasl: null, varieties: null, species: null, flavorProfile: null, roastDate: null, detailedRoastLevel: null, roastLevel: null, roastType: null, blendType: null, decaf: null, bagWeightGrams: null, batchNumber: null, website: "https://onyxcoffeelab.com/" };
const data = { images: ["AAA"], processes: ["Washed"], requestedBy: "u" };

beforeEach(() => {
  complete.mockReset().mockResolvedValue({ message: { content: JSON.stringify(label), refusal: null }, usage: null });
  respond.mockReset();
});

describe("readLabel (docs/api/llm-contract.md §9c)", () => {
  it("reads the label, or looks it up on the web on its own", async () => {
    expect(await readLabel(data)).toEqual({ fields: label, web: null, webSources: [], webError: null });
    expect(respond).not.toHaveBeenCalled();
    complete.mockClear();
    const page = "https://onyxcoffeelab.com/products/geometry";
    const shop = "https://onyxcoffeelab.com/collections/coffee";
    respond.mockResolvedValue({ text: JSON.stringify({ ...Object.fromEntries(LABEL_WEB_FIELDS.map((f) => [f, null])), producer: { value: "Many farms", url: page } }), refusal: null, visited: [shop, page] });
    const lookUp = { ...data, images: [], lookUp: label };
    expect(await readLabel(lookUp)).toEqual({ fields: label, web: { producer: { value: "Many farms", url: page } }, webSources: [page, shop], webError: null });
    expect(complete).not.toHaveBeenCalled(); // no photos read again
  });

  it("a failed lookup answers webError: try again, or not supported", async () => {
    const lookUp = { ...data, images: [], lookUp: label };
    respond.mockRejectedValue(new Error("Connection error."));
    const result = await readLabel(lookUp);
    expect(result).toMatchObject({ fields: label, web: null, webSources: [] });
    expect(result.webError).toMatch(/this time/);
    respond.mockRejectedValue(new UnrecoverableError("OpenAI rejected the request (400): web_search is not supported"));
    expect((await readLabel(lookUp)).webError).toMatch(/may not support web search/);
  });
});
