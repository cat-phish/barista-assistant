import { describe, expect, it } from "vitest";
import { PROMPT_TEXT } from "@barista/shared/aiPrompt";
import request from "supertest";
import { app } from "../src/app.js";
import { newUser } from "./helpers.js";

// Your AI prompt (docs/api/auth.md §1c): per person.
const URL = "/api/auth/me/ai-prompt";

describe("your AI prompt", () => {
  it("starts as the defaults, with every section to show", async () => {
    const me = await newUser();
    const res = await me.agent.get(URL);
    expect(res.status).toBe(200);
    expect(res.body.aiPrompt).toEqual({ instructions: null, labelInstructions: null, overrides: {} });
    expect(res.body.sections.map((s: { key: string }) => s.key)).toContain("suggestCore");
    expect(res.body.sections.find((s: { key: string }) => s.key === "end")).toMatchObject({ locked: true });
    expect(res.body.limits).toEqual({ instructions: 2000, section: 4000, note: 500 });
  });

  it("saves instructions and section texts, only the caller's", async () => {
    const me = await newUser();
    const other = await newUser();
    const body = { instructions: "  I like bright, light cups.  ", overrides: { core: "Be brief.", water: PROMPT_TEXT.water! } };
    const res = await me.agent.put(URL).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Trimmed; a section left at its default isn't kept.
    expect(res.body.aiPrompt).toEqual({ instructions: "I like bright, light cups.", labelInstructions: null, overrides: { core: "Be brief." } });
    expect((await me.agent.get(URL)).body.aiPrompt).toEqual(res.body.aiPrompt);
    expect((await other.agent.get(URL)).body.aiPrompt).toEqual({ instructions: null, labelInstructions: null, overrides: {} });

    // Back to the defaults.
    expect((await me.agent.put(URL).send({ instructions: "", overrides: {} })).body.aiPrompt).toEqual({ instructions: null, labelInstructions: null, overrides: {} });
  });

  it("refuses locked or unknown sections, and text too long", async () => {
    const me = await newUser();
    const send = (body: unknown) => me.agent.put(URL).send(body);
    expect((await send({ instructions: null, overrides: { output: "Answer in prose." } })).body.error).toMatch(/can't be changed/);
    expect((await send({ instructions: null, overrides: { nonsense: "x" } })).body.error).toMatch(/not a prompt section/);
    expect((await send({ instructions: "x".repeat(2001), overrides: {} })).status).toBe(400);
    expect((await send({ instructions: null, overrides: { core: "x".repeat(4001) } })).status).toBe(400);
    expect((await send({ instructions: null, overrides: { core: "   " } })).status).toBe(400);
    expect((await send({ instructions: null })).status).toBe(400);
    expect((await send({ instructions: null, labelInstructions: "x".repeat(2001), overrides: {} })).status).toBe(400);
  });

  it("needs signing in", async () => {
    expect((await request(app).get(URL)).status).toBe(401);
  });
  it("keeps label instructions and the label section apart from the brewing ones", async () => {
    const me = await newUser();
    const res = await me.agent.put(URL).send({ instructions: null, labelInstructions: " Dates are DD.MM.YY. ", overrides: { labelCore: "Read the label." } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.aiPrompt).toEqual({ instructions: null, labelInstructions: "Dates are DD.MM.YY.", overrides: { labelCore: "Read the label." } });
    expect(res.body.labelInstructionsIntro).toMatch(/reading labels/);
    expect(res.body.sections.find((x: { key: string }) => x.key === "labelCore").prompts).toEqual(["label"]);
    // Left out, they're cleared like the rest.
    expect((await me.agent.put(URL).send({ instructions: null, overrides: {} })).body.aiPrompt).toEqual({ instructions: null, labelInstructions: null, overrides: {} });
  });
});
