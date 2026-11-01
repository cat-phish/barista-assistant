import type { AiCheckJobData, AiCheckResult } from "@barista/shared/jobs";
import { BREW_ANALYSIS_JSON_SCHEMA, complete } from "../llm.js";
import { withoutKey, type AiClient } from "./client.js";
import { resolveAi, resolveServerAi } from "./resolve.js";

// A tiny request with the real analysis schema, so a model that can't
// return it shows up here rather than on a brew. Vision and web aren't tried.
async function testModel(ai: AiClient): Promise<void> {
  const { message } = await complete(ai, {
    model: ai.models.main,
    messages: [
      { role: "system", content: "Answer with a very short placeholder in every field: this is a connection test." },
      { role: "user", content: "{}" },
    ],
    response_format: { type: "json_schema", json_schema: { name: "brew_analysis", strict: true, schema: BREW_ANALYSIS_JSON_SCHEMA } },
  });
  if (message?.refusal) throw new Error(message.refusal);
  JSON.parse(message?.content ?? ""); // throws on an empty or non-JSON answer
}

async function listModels(ai: AiClient): Promise<string[]> {
  const ids: string[] = [];
  for await (const model of ai.openai.models.list()) ids.push(model.id);
  return ids.sort();
}

// Settings' Test and model list (docs/api/workspaces.md §2d): a failure is the
// answer, with the provider's reason, so it never fails the job.
export async function runAiCheck(data: AiCheckJobData): Promise<AiCheckResult> {
  let ai: AiClient | null = null;
  try {
    ai = data.workspaceId ? await resolveAi(data.workspaceId) : await resolveServerAi();
    if (data.action === "models") return { ok: true, models: await listModels(ai), error: null };
    await testModel(ai);
    return { ok: true, models: [], error: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, models: [], error: ai ? withoutKey(reason, ai.apiKey) : reason };
  }
}
