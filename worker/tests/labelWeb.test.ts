import { LABEL_INSTRUCTIONS_INTRO, PROMPT_TEXT } from "@barista/shared/aiPrompt";
import { LABEL_WEB_FIELDS, type LabelFields } from "@barista/shared/jobs";
import { describe, expect, it } from "vitest";
import { buildWebRequest, hostOf, labelWebJsonSchema, parseWebReply, webSystemPrompt } from "../src/labelWeb.js";

const PROCESSES = ["Washed", "Natural"];
const LABEL: LabelFields = {
  roasterName: "Proud Mary Coffee Roasters",
  beanName: "Elida Estate",
  processName: "Natural",
  processText: null,
  country: "Panama",
  region: null,
  producer: null,
  altitudeMasl: null,
  flavorProfile: null,
  roastDate: "2026-10-20",
  detailedRoastLevel: null,
  roastLevel: null,
  roastType: null,
  blendType: null,
  decaf: null,
  bagWeightGrams: 250,
  batchNumber: "B12",
  website: "https://proudmarycoffee.com/",
};
const job = { images: ["AAA"], processes: PROCESSES, requestedBy: "u", web: true };
const reply = (body: unknown, visited: string[] = ["https://proudmarycoffee.com/products/elida"]) => ({ text: JSON.stringify(body), refusal: null, visited });
const none = Object.fromEntries(LABEL_WEB_FIELDS.map((f) => [f, null]));

describe("looking a bean up on the web (docs/api/llm-contract.md §9c)", () => {
  it("searches the roaster's site with the label's text, never the photos or one bag's details", () => {
    expect(hostOf("https://www.proudmarycoffee.com/x")).toBe("proudmarycoffee.com");
    expect(hostOf("javascript:alert(1)")).toBeNull();
    const request = buildWebRequest(LABEL, job);
    expect(request.tools).toEqual([{ type: "web_search", search_context_size: "high", filters: { allowed_domains: ["proudmarycoffee.com"] } }]);
    expect(request.input).toContain("Elida Estate");
    expect(request.input).toContain("product page");
    expect(request.input).not.toContain("2026-10-20");
    expect(request.input).not.toContain("B12");
    expect(request.input).not.toContain("AAA");
    // No website on the label: the form's; neither: the whole web.
    expect(buildWebRequest({ ...LABEL, website: null }, { ...job, website: "onyxcoffeelab.com" }).tools).toEqual([
      { type: "web_search", search_context_size: "high", filters: { allowed_domains: ["onyxcoffeelab.com"] } },
    ]);
    expect(buildWebRequest({ ...LABEL, website: null }, job).tools).toEqual([{ type: "web_search", search_context_size: "high" }]);
    // The workspace's labelWebContext.
    expect(buildWebRequest({ ...LABEL, website: null }, { ...job, webContext: "low" }).tools).toEqual([{ type: "web_search", search_context_size: "low" }]);
    const schema = labelWebJsonSchema(PROCESSES) as { required: string[] };
    expect(schema.required).not.toContain("roastDate");
    expect(schema.required).not.toContain("batchNumber");
  });

  it("uses the person's label prompt", () => {
    expect(webSystemPrompt()).toBe(`${PROMPT_TEXT.labelWeb} ${PROMPT_TEXT.end}`);
    expect(webSystemPrompt({ instructions: "x", labelInstructions: "Prefer the shop page.", overrides: { labelWeb: "Look it up." } })).toBe(
      `Look it up. ${LABEL_INSTRUCTIONS_INTRO} Prefer the shop page. ${PROMPT_TEXT.end}`,
    );
  });

  it("keeps a value only with a page the search visited, on the roaster's site", () => {
    const page = "https://proudmarycoffee.com/products/elida";
    const finds = parseWebReply(
      reply({
        ...none,
        producer: { value: "Lamastus family", url: page },
        altitudeMasl: { value: 1900, url: page },
        region: { value: "Boquete", url: "https://some-blog.com/elida" }, // never visited
        flavorProfile: { value: "Jasmine, peach", url: "https://shop.example.com/elida" }, // visited, but off the roaster's site
        processName: { value: "Natural", url: page },
        processText: { value: "Natural", url: page },
        bagWeightGrams: { value: -3, url: page }, // not a weight
      }, [page, "https://shop.example.com/elida"]),
      PROCESSES,
      "proudmarycoffee.com",
    );
    expect(finds).toEqual({
      producer: { value: "Lamastus family", url: page },
      altitudeMasl: { value: 1900, url: page },
      processName: { value: "Natural", url: page },
    });
    // Unlimited search: any page it visited.
    expect(parseWebReply(reply({ ...none, region: { value: "Boquete", url: "https://shop.example.com/elida" } }, ["https://shop.example.com/"]), PROCESSES, null)).toEqual({
      region: { value: "Boquete", url: "https://shop.example.com/elida" },
    });
  });

  it("fails on a refusal or a reply that isn't JSON", () => {
    expect(() => parseWebReply({ text: "", refusal: "no", visited: [] }, PROCESSES, null)).toThrow(/refused/);
    expect(() => parseWebReply({ text: "nope", refusal: null, visited: [] }, PROCESSES, null)).toThrow(/invalid JSON/);
  });
});
