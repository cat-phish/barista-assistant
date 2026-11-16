// Security audit round 2, AI findings (audit/findings/R2-ai.md). Each test
// fails today and passes once the finding is fixed.
import { AI_SERVER_KEY, DEFAULT_SERVER_AI } from "@barista/shared/aiConfig";
import { LABEL_WEB_FIELDS } from "@barista/shared/jobs";
import { serverSettings } from "@barista/shared/schema";
import { encryptSecret } from "@barista/shared/secrets";
import { describe, expect, it } from "vitest";
import { resolveAi } from "../src/ai/resolve.js";
import { db } from "../src/db.js";
import { parseWebReply } from "../src/labelWeb.js";
import { buildChatRequest } from "../src/llm.js";

const SECRET = process.env.AI_CONFIG_SECRET!;
const serverAi = (value: Partial<typeof DEFAULT_SERVER_AI>) =>
  db.insert(serverSettings).values({ key: AI_SERVER_KEY, value: { ...DEFAULT_SERVER_AI, apiKeyEncrypted: encryptSecret("server-key", SECRET), model: "local", ...value } });

describe("SEC-53: the admin's base URL can't hold a worker job for the SDK's full window", () => {
  const SDK_DEFAULT_TIMEOUT = 600_000; // 10 min per request, 2 retries

  it("builds the OpenAI client with its own timeout and at most one retry", async () => {
    await serverAi({ baseUrl: "http://127.0.0.1:1/v1" });
    const ai = await resolveAi();
    if (ai.provider !== "openai") throw new Error("expected openai");
    expect(ai.openai.timeout).toBeLessThan(SDK_DEFAULT_TIMEOUT);
    expect(ai.openai.maxRetries).toBeLessThanOrEqual(1);
  });

  it("builds the Anthropic client the same way", async () => {
    await serverAi({ provider: "anthropic", baseUrl: "http://127.0.0.1:1" });
    const ai = await resolveAi();
    if (ai.provider !== "anthropic") throw new Error("expected anthropic");
    expect(ai.anthropic.timeout).toBeLessThan(SDK_DEFAULT_TIMEOUT);
    expect(ai.anthropic.maxRetries).toBeLessThanOrEqual(1);
  });
});

describe("SEC-81: journal attachments and the rolling summary are data, not system instructions", () => {
  it("keeps other members' text and the AI-written summary out of the system message", () => {
    const turns = [{ role: "user" as const, content: "Hi" }];
    const attached = [{ ref: "a1", kind: "bean", label: "x", flavorProfile: "ATTACH-MARKER" }];
    const { messages } = buildChatRequest("m", turns, undefined, attached, "SUMMARY-MARKER");
    const system = String(messages[0]!.content);
    expect(system).not.toContain("ATTACH-MARKER");
    expect(system).not.toContain("SUMMARY-MARKER");
    // Sent ahead of the conversation as a user turn instead.
    const data = messages.slice(1, -turns.length).map((m) => `${m.role}:${String(m.content)}`).join("\n");
    expect(data).toMatch(/^user:/);
    expect(data).toContain("ATTACH-MARKER");
    expect(data).toContain("SUMMARY-MARKER");
  });
});

describe("SEC-83: a web find's source must be a page the search read, and the website the roaster's", () => {
  const none = Object.fromEntries(LABEL_WEB_FIELDS.map((f) => [f, null]));
  const PAGE = "https://roaster.example/coffee";

  it("drops a find whose source only shares a host with a visited page", () => {
    const body = { ...none, region: { value: "Huila", url: "https://roaster.example/evil-path" } };
    const finds = parseWebReply({ text: JSON.stringify(body), refusal: null, visited: [PAGE] }, [], null);
    expect(finds.region).toBeUndefined();
  });

  it("drops a website find that points off the page it was read from", () => {
    const body = { ...none, website: { value: "https://attacker.example", url: PAGE } };
    const finds = parseWebReply({ text: JSON.stringify(body), refusal: null, visited: [PAGE] }, [], null);
    expect(finds.website).toBeUndefined();
  });
});
