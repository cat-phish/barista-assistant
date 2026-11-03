import { randomUUID } from "node:crypto";
import { aiChatMessages, aiChats, beans, brewers, brewLogs, grinders, recipes, users, workspaces, type ChatProposal } from "@barista/shared/schema";
import type { ChatStreamEvent } from "@barista/shared/jobs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiClient } from "../src/ai/client.js";
import { resolveAi } from "../src/ai/resolve.js";
import { chatTurns, processChatReply, type ChatPublisher } from "../src/chat.js";
import { checkProposal, checkProposals, proposalFilter, refTable, splitProposals, type RefTable } from "../src/chatProposals.js";
import { db } from "../src/db.js";
import { streamReply } from "../src/llm.js";

vi.mock("../src/llm.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/llm.js")>()), streamReply: vi.fn() }));
vi.mock("../src/ai/resolve.js", () => ({ resolveAi: vi.fn() }));
const stream = vi.mocked(streamReply);
vi.mocked(resolveAi).mockResolvedValue({ provider: "openai", apiKey: "k", models: { main: "m", vision: "m", web: "m" } } as unknown as AiClient);

const block = (json: object) => "```proposal\n" + JSON.stringify(json) + "\n```";

describe("proposalFilter", () => {
  const run = (pieces: string[]) => {
    const out: string[] = [];
    const f = proposalFilter((t) => out.push(t));
    pieces.forEach((p) => f.add(p));
    f.end();
    return out.join("");
  };
  it("passes text on and holds back a proposal block, even split across pieces", () => {
    expect(run(["Grind finer.\n\n``", "`prop", 'osal\n{"kind":', '"brew"}\n```'])).toBe("Grind finer.");
  });
  it("lets go of backticks that turn out not to start a proposal", () => {
    expect(run(["Use `code` and ``", "`js\nx\n```"])).toBe("Use `code` and ```js\nx\n```");
    expect(run(["ends with ``"])).toBe("ends with ``");
  });
});

describe("splitProposals", () => {
  it("takes the blocks out of the text, and reads one cut off at the end", () => {
    const { text, blocks } = splitProposals(`Try this.\n\n${block({ a: 1 })}\n\n${"```proposal\n"}{"b":2}`);
    expect(text).toBe("Try this.");
    expect(blocks).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it("leaves out a block that isn't JSON", () => {
    expect(splitProposals("Hi\n```proposal\nnot json\n```").blocks).toEqual([]);
  });
});

describe("checkProposal", () => {
  const refs: RefTable = new Map([
    [
      "a1",
      {
        kind: "brew",
        id: "brew1",
        label: "Brew",
        bean: { id: "bean1", label: "Onyx Guji" },
        recipe: { id: "rec1", label: "House V60" },
        brewer: { id: "v60", label: "V60", kind: "filter" },
        grinder: { id: "g1", label: "C40", min: 0, max: 40 },
      },
    ],
    ["a2", { kind: "recipe", id: "rec2", label: "Espresso", recipe: { id: "rec2", label: "Espresso" }, brewer: { id: "lm", label: "Linea", kind: "espresso" } }],
    ["a3", { kind: "bean", id: "bean2", label: "Kenya", bean: { id: "bean2", label: "Kenya" } }],
  ]);
  const why = { title: "One finer", why: "It was sour." };

  it("reads a brew from an attached brew, rounding and leaving out what doesn't apply", () => {
    expect(checkProposal({ kind: "brew", ...why, from: "a1", bean: "a3", grindSetting: 18.456, tempC: 95.04, ratio: 16.666 }, refs)).toEqual({
      kind: "brew",
      ...why,
      state: "open",
      beanId: "bean2",
      beanLabel: "Kenya",
      recipeId: "rec1",
      recipeLabel: "House V60",
      grinderId: "g1",
      grinderLabel: "C40",
      grindSetting: 18.46,
      tempC: 95,
      ratio: 16.67,
    });
    // Off the dial, no grinder, a ratio the method doesn't brew at.
    expect(checkProposal({ kind: "brew", ...why, from: "a1", grindSetting: 55 }, refs)).toMatchObject({ grindSetting: null, grinderId: null, beanId: "bean1" });
    expect(checkProposal({ kind: "brew", ...why, recipe: "a2", grindSetting: 10, ratio: 16 }, refs)).toMatchObject({ recipeId: "rec2", grindSetting: null, ratio: null });
    expect(checkProposal({ kind: "brew", ...why, recipe: "a2", ratio: 2 }, refs)).toMatchObject({ ratio: 2 });
  });
  it("drops one naming what isn't attached, or of the wrong kind, or with nothing in it", () => {
    expect(checkProposal({ kind: "brew", ...why, from: "a9", tempC: 94 }, refs)).toBeNull();
    expect(checkProposal({ kind: "brew", ...why, from: "a3", tempC: 94 }, refs)).toBeNull();
    expect(checkProposal({ kind: "brew", ...why, bean: "a2" }, refs)).toBeNull();
    expect(checkProposal({ kind: "brew", ...why }, refs)).toBeNull();
    expect(checkProposal({ kind: "brew", ...why, tempC: 140 }, refs)).toBeNull();
    expect(checkProposal({ kind: "teleport", ...why }, refs)).toBeNull();
  });
  it("reads a recipe change, from a recipe or a brew's recipe", () => {
    expect(checkProposal({ kind: "recipeChange", ...why, recipe: "a1", changes: { targetTempC: 93.25, steps: [{ stepType: "bloom", durationSec: 45, targetWaterGrams: 45 }] } }, refs)).toEqual({
      kind: "recipeChange",
      ...why,
      state: "open",
      recipeId: "rec1",
      recipeLabel: "House V60",
      changes: { targetTempC: 93.3, steps: [{ stepType: "bloom", label: null, durationSec: 45, targetWaterGrams: 45, targetTempC: null, pressureBar: null, flowRate: null }] },
    });
    expect(checkProposal({ kind: "recipeChange", ...why, recipe: "a3", changes: { targetTempC: 93 } }, refs)).toBeNull();
    expect(checkProposal({ kind: "recipeChange", ...why, recipe: "a2", changes: {} }, refs)).toBeNull();
    expect(checkProposal({ kind: "recipeChange", ...why, recipe: "a2", changes: { expectedFinishMinSec: 40, expectedFinishMaxSec: 30 } }, refs)).toBeNull();
    expect(checkProposal({ kind: "recipeChange", ...why, recipe: "a2", changes: { steps: [{ stepType: "dance" }] } }, refs)).toBeNull();
  });
  it("reads a new recipe, on what it's based on's brewer or none", () => {
    expect(checkProposal({ kind: "newRecipe", ...why, basedOn: "a2", recipe: { name: "Turbo", targetDoseGrams: 18, expectedYieldGrams: 54 } }, refs)).toMatchObject({
      brewerId: "lm",
      brewerLabel: "Linea",
      recipe: { name: "Turbo", targetDoseGrams: 18, expectedYieldGrams: 54 },
    });
    expect(checkProposal({ kind: "newRecipe", ...why, recipe: { name: "Iced", targetDoseGrams: 20 } }, refs)).toMatchObject({ brewerId: null });
    expect(checkProposal({ kind: "newRecipe", ...why, recipe: { name: "No dose" } }, refs)).toBeNull();
    expect(checkProposal({ kind: "newRecipe", ...why, basedOn: "a3", recipe: { name: "X", targetDoseGrams: 15 } }, refs)).toBeNull();
  });
  it("keeps at most 3", () => {
    expect(checkProposals(Array.from({ length: 5 }, () => ({ kind: "brew", ...why, tempC: 94 })), refs)).toHaveLength(3);
  });
});

describe("refTable and processChatReply", () => {
  let workspaceId: string;
  let chatId: string;
  let replyId: string;
  let ids: { bean: string; brewer: string; recipe: string; grinder: string; brew: string };
  let events: ChatStreamEvent[];
  const publisher: ChatPublisher = { publish: async (_id, event) => void events.push(event) };

  beforeEach(async () => {
    stream.mockReset();
    events = [];
    workspaceId = randomUUID();
    ids = { bean: randomUUID(), brewer: randomUUID(), recipe: randomUUID(), grinder: randomUUID(), brew: randomUUID() };
    await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: workspaceId });
    await db.insert(beans).values({ id: ids.bean, workspaceId, roasterName: "Onyx", beanName: "Guji" });
    await db.insert(brewers).values({ id: ids.brewer, workspaceId, name: "V60", kind: "filter" });
    await db.insert(recipes).values({ id: ids.recipe, workspaceId, name: "House V60", brewerId: ids.brewer, targetDoseGrams: 15, targetWaterGrams: 250 });
    await db.insert(grinders).values({ id: ids.grinder, workspaceId, name: "C40", settingMin: 0, settingMax: 40 });
    await db.insert(brewLogs).values({ id: ids.brew, workspaceId, beanId: ids.bean, recipeId: ids.recipe, brewerId: ids.brewer, grinderId: ids.grinder, actualDoseGrams: 15, actualTimeSec: 180 });
    const userId = randomUUID();
    chatId = randomUUID();
    replyId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, passwordHash: "x" });
    await db.insert(aiChats).values({ id: chatId, workspaceId, userId, title: "T" });
    await db.insert(aiChatMessages).values([
      { id: randomUUID(), chatId, position: 1, role: "user", content: "Sour?", status: "done", attachments: [{ kind: "brew", id: ids.brew, label: "Brew" }] },
      { id: replyId, chatId, position: 2, role: "assistant", content: "", status: "pending" },
    ]);
  });

  it("reads what a brew ref names from this workspace only", async () => {
    const table = await refTable([{ kind: "bean", id: ids.bean, label: "B" }, { kind: "brew", id: ids.brew, label: "Brew" }], workspaceId);
    expect(table.get("a1")).toMatchObject({ bean: { id: ids.bean, label: "Onyx Guji" } });
    expect(table.get("a2")).toMatchObject({ recipe: { id: ids.recipe }, brewer: { id: ids.brewer, kind: "filter" }, grinder: { id: ids.grinder, min: 0, max: 40 } });
    expect((await refTable([{ kind: "brew", id: ids.brew, label: "Brew" }], randomUUID())).size).toBe(0);
  });

  it("streams the text without the blocks and saves the proposals on the reply", async () => {
    stream.mockImplementation(async (_ai, request, onText) => {
      expect(JSON.stringify(request.messages[0])).toContain('\\"ref\\":\\"a1\\"');
      onText("Go one finer.\n\n");
      onText(block({ kind: "brew", title: "One finer", why: "Sour.", from: "a1", grindSetting: 17 }));
      onText("\n" + block({ kind: "brew", title: "Bad", why: "x", from: "a7", tempC: 90 }));
      return { refusal: null, usage: null };
    });
    expect(await processChatReply({ messageId: replyId, photos: [] }, publisher)).toEqual({ status: "saved" });
    const streamed = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
    expect(streamed).toBe("Go one finer.");
    const [row] = await db.select().from(aiChatMessages).where(eq(aiChatMessages.id, replyId));
    expect(row!.content).toBe("Go one finer.");
    expect(row!.proposals).toEqual([
      { kind: "brew", title: "One finer", why: "Sour.", state: "open", beanId: ids.bean, beanLabel: "Onyx Guji", recipeId: ids.recipe, recipeLabel: "House V60", grinderId: ids.grinder, grinderLabel: "C40", grindSetting: 17, tempC: null, ratio: null },
    ]);
  });

  it("saves a reply with no proposals as before", async () => {
    stream.mockImplementation(async (_ai, _request, onText) => {
      onText("Hi");
      return { refusal: null, usage: null };
    });
    await processChatReply({ messageId: replyId, photos: [] }, publisher);
    const [row] = await db.select().from(aiChatMessages).where(eq(aiChatMessages.id, replyId));
    expect(row).toMatchObject({ content: "Hi", proposals: null });
  });
});

describe("chatTurns with proposals", () => {
  it("tells the AI what an earlier reply proposed and whether it was dismissed", () => {
    const proposals: ChatProposal[] = [{ kind: "newRecipe", title: "Iced", why: "Hot day.", state: "dismissed", brewerId: null, brewerLabel: null, recipe: { name: "Iced", targetDoseGrams: 20 } }];
    const turns = chatTurns(
      [
        { position: 1, role: "user", status: "done", content: "Hi" },
        { position: 2, role: "assistant", status: "done", content: "Try this.", proposals },
      ],
      3,
    );
    expect(turns[1]!.content).toContain("Try this.\n\n[Shown as proposal cards with this reply:");
    expect(turns[1]!.content).toContain('"dismissed":true');
    expect(turns[1]!.content).not.toContain('"state"');
  });
});
