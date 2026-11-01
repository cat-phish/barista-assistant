import { beforeEach, describe, expect, it, vi } from "vitest";

const complete = vi.fn();
const list = vi.fn();
vi.mock("../src/llm.js", async (original) => ({ ...(await original<typeof import("../src/llm.js")>()), complete }));
vi.mock("../src/ai/resolve.js", () => ({
  resolveAi: async () => ({ apiKey: "sk-secret", models: { main: "m", vision: "m", web: "m" }, openai: { models: { list } } }),
  resolveServerAi: async () => ({ apiKey: "sk-server", models: { main: "s", vision: "s", web: "s" }, openai: { models: { list } } }),
}));
const { runAiCheck } = await import("../src/ai/check.js");

beforeEach(() => {
  complete.mockReset().mockResolvedValue({ message: { content: '{"reasoning":"x"}', refusal: null }, usage: null });
  list.mockReset();
});

describe("runAiCheck (docs/api/workspaces.md §2d)", () => {
  it("tests with the real analysis schema", async () => {
    expect(await runAiCheck({ workspaceId: "w", action: "test" })).toEqual({ ok: true, models: [], error: null });
    expect(complete.mock.calls[0]![1].response_format.json_schema.name).toBe("brew_analysis");
  });

  it("answers a failure with the reason, without the key", async () => {
    complete.mockRejectedValue(new Error("bad key sk-secret"));
    expect(await runAiCheck({ workspaceId: "w", action: "test" })).toEqual({ ok: false, models: [], error: "bad key [key]" });
    complete.mockResolvedValue({ message: { content: "not json", refusal: null }, usage: null });
    expect((await runAiCheck({ workspaceId: "w", action: "test" })).ok).toBe(false);
  });

  it("lists models, sorted", async () => {
    list.mockReturnValue((async function* () {
      yield { id: "b" };
      yield { id: "a" };
    })());
    expect((await runAiCheck({ workspaceId: null, action: "models" })).models).toEqual(["a", "b"]);
  });
});
