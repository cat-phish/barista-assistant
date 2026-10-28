import type { LabelFields } from "@barista/shared/jobs";
import { describe, expect, it } from "vitest";
import { buildLabelRequest, labelJsonSchema, parseLabelMessage } from "../src/label.js";

const reply = (body: unknown) => ({ content: JSON.stringify(body), refusal: null });
const PROCESSES = ["Washed", "Natural", "Honey"];
const EMPTY: LabelFields = {
  roasterName: null,
  beanName: null,
  processName: null,
  processText: null,
  country: null,
  region: null,
  producer: null,
  altitudeMasl: null,
  flavorProfile: null,
  roastDate: null,
  detailedRoastLevel: null,
  roastLevel: null,
  roastType: null,
  blendType: null,
  decaf: null,
  bagWeightGrams: null,
  batchNumber: null,
  website: null,
};

describe("reading a bean label (docs/api/llm-contract.md §9c)", () => {
  it("sends each photo as an image, with the processes to choose from", () => {
    const request = buildLabelRequest({ images: ["AAA", "BBB"], processes: PROCESSES });
    expect(request.model).toBe("test-model"); // OPENAI_VISION_MODEL unset: OPENAI_MODEL
    const user = request.messages[1] as { content: Array<{ type: string; text?: string; image_url?: { url: string } }> };
    expect(user.content.map((p) => p.type)).toEqual(["text", "image_url", "image_url"]);
    expect(user.content[0]!.text).toContain("Washed, Natural, Honey");
    expect(user.content[1]!.image_url!.url).toBe("data:image/webp;base64,AAA");
    const schema = labelJsonSchema(PROCESSES) as { required: string[]; properties: Record<string, { anyOf?: Array<{ enum?: string[] }> }> };
    expect(schema.required.sort()).toEqual(Object.keys(EMPTY).sort());
    expect(schema.properties.processName!.anyOf![0]!.enum).toEqual(PROCESSES);
    // No processes: it can only answer null there.
    expect((labelJsonSchema([]) as { properties: Record<string, unknown> }).properties.processName).toEqual({ type: "null" });
  });

  it("keeps what the bean form would take", () => {
    const fields = parseLabelMessage(
      reply({
        ...EMPTY,
        roasterName: "  Onyx  Coffee Lab ",
        beanName: "Geometry",
        processName: "Washed",
        processText: "Washed",
        country: "Ethiopia",
        altitudeMasl: 2100,
        flavorProfile: "Peach, jasmine",
        roastDate: "2026-10-20",
        detailedRoastLevel: "city",
        roastType: "filter",
        blendType: "single_origin",
        decaf: false,
        bagWeightGrams: 340,
        website: "onyxcoffeelab.com",
      }),
      PROCESSES,
    );
    expect(fields).toEqual({
      ...EMPTY,
      roasterName: "Onyx Coffee Lab",
      beanName: "Geometry",
      processName: "Washed",
      processText: null, // matched, so not repeated
      country: "Ethiopia",
      altitudeMasl: 2100,
      flavorProfile: "Peach, jasmine",
      roastDate: "2026-10-20",
      detailedRoastLevel: "city",
      roastType: "filter",
      blendType: "single_origin",
      decaf: null, // only "yes, decaf" is worth filling
      bagWeightGrams: 340,
      website: "https://onyxcoffeelab.com/",
    });
  });

  it("drops values the form wouldn't take, without failing the rest", () => {
    const fields = parseLabelMessage(
      reply({
        ...EMPTY,
        beanName: "Kenya AA",
        processName: "Anaerobic", // not one of the workspace's
        processText: "Anaerobic natural",
        altitudeMasl: 12000,
        roastDate: "2999-01-01",
        detailedRoastLevel: "burnt",
        bagWeightGrams: -5,
        batchNumber: "x".repeat(51),
        website: "javascript:alert(1)",
        region: "   ",
      }),
      PROCESSES,
    );
    expect(fields).toEqual({ ...EMPTY, beanName: "Kenya AA", processText: "Anaerobic natural" });
    expect(parseLabelMessage(reply({ ...EMPTY, roastDate: "2026-02-30" }), PROCESSES).roastDate).toBeNull();
  });

  it("fails on a refusal or a reply that isn't JSON", () => {
    expect(() => parseLabelMessage({ content: null, refusal: "no" }, PROCESSES)).toThrow(/refused/);
    expect(() => parseLabelMessage({ content: "nope", refusal: null }, PROCESSES)).toThrow(/invalid JSON/);
  });
});
