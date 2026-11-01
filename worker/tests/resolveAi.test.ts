import { UnrecoverableError } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../src/config.js");
});

async function withConfig(values: Record<string, string | null>) {
  const { config } = await vi.importActual<typeof import("../src/config.js")>("../src/config.js");
  vi.doMock("../src/config.js", () => ({ config: { ...config, ...values } }));
  return import("../src/ai/resolve.js");
}

describe("resolveAi", () => {
  it("uses the env's models, vision and web falling back to main", async () => {
    const { resolveAi } = await withConfig({ openaiApiKey: "k", openaiModel: "main", openaiVisionModel: null, openaiWebModel: null });
    expect((await resolveAi()).models).toEqual({ main: "main", vision: "main", web: "main" });
  });

  it("fails without retries when nothing is set up", async () => {
    const { NO_AI, resolveAi } = await withConfig({ openaiApiKey: null });
    const failure = await resolveAi("w").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UnrecoverableError);
    expect((failure as Error).message).toBe(NO_AI);
  });
});
