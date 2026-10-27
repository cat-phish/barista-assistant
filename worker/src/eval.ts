// Compare prompt versions on real brews (docs/api/llm-contract.md §9,
// "Evaluating changes"). Run on the host from the repo root; it reads the
// root .env (database password, OpenAI key and model), only reads the
// database, and writes to eval/ (git-ignored: it's your brews).
//
//   npm run eval -w worker -- snapshot [--limit 12]   choose the brews
//   npm run eval -w worker -- run --label baseline [--yes]
//   npm run eval -w worker -- run --label sug --suggest [beanRecipe] [--yes]
//   npm run eval -w worker -- compare baseline after
//
// `run` builds each brew's context with the code as it is now and sends it
// through the prompt as it is now, so run it before and after a change.
// With --suggest it asks "Suggest parameters" instead, as if setting up each
// brew (its bean, recipe, brewer and grinder; brews before it, from the
// source given, default beanRecipe), so the values can be held against the
// brew as it went.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const ROOT = fileURLToPath(new URL("../../", import.meta.url)); // worker/src or worker/dist -> repo root
const OUT = path.join(ROOT, "eval");

// The app's own settings, pointed at the database on this machine.
function useRootEnv(): void {
  const env = parse(readFileSync(path.join(ROOT, ".env")));
  Object.assign(process.env, {
    DATABASE_URL: process.env.EVAL_DATABASE_URL ?? "mysql://barista@localhost:3306/coffee_journal",
    DATABASE_PASSWORD: env.MARIADB_PASSWORD ?? "",
    REDIS_URL: "redis://localhost:6379", // required by the config, never used here
    OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? env.OPENAI_MODEL ?? "",
    BREW_TIMEZONE: env.BREW_TIMEZONE ?? "",
  });
}

interface Picked {
  brewLogId: string;
  timestamp: string;
  rating: number | null;
  drinkRating: number | null;
  tastingNotes: string | null;
  problems: string[];
  stored: { promptVersion: string | null; helpful: boolean | null; reasoning: string } | null; // the latest saved analysis
}
interface RunResult {
  label: string;
  promptVersion: string;
  model: string;
  at: string;
  results: Array<{
    brewLogId: string;
    contextChars: number; // the input sent, in characters
    context: unknown; // the input sent
    output: unknown;
    usage: { promptTokens: number; completionTokens: number } | null;
    error: string | null;
  }>;
}

const flag = (args: string[], name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const readJson = <T>(file: string): T => JSON.parse(readFileSync(path.join(OUT, file), "utf8")) as T;
const writeJson = (file: string, data: unknown) => writeFileSync(path.join(OUT, file), JSON.stringify(data, null, 2));

async function snapshot(limit: number): Promise<void> {
  const { db } = await import("./db.js");
  const { brewLogs, brewLogProblems, brewProblems, llmAnalyses } = await import("@barista/shared/schema");
  const { and, desc, eq, isNotNull, or } = await import("drizzle-orm");
  const rows = await db
    .select({ id: brewLogs.id, timestamp: brewLogs.timestamp, rating: brewLogs.rating, drinkRating: brewLogs.drinkRating, tastingNotes: brewLogs.tastingNotes })
    .from(brewLogs)
    .where(and(eq(brewLogs.steeping, false), or(isNotNull(brewLogs.rating), isNotNull(brewLogs.drinkRating))))
    .orderBy(desc(brewLogs.timestamp))
    .limit(limit);
  const picked: Picked[] = [];
  for (const r of rows) {
    const problems = await db
      .select({ name: brewProblems.name })
      .from(brewLogProblems)
      .innerJoin(brewProblems, eq(brewLogProblems.problemId, brewProblems.id))
      .where(eq(brewLogProblems.brewLogId, r.id));
    const [stored] = await db
      .select({ promptVersion: llmAnalyses.promptVersion, helpful: llmAnalyses.helpful, reasoning: llmAnalyses.reasoning })
      .from(llmAnalyses)
      .where(eq(llmAnalyses.brewLogId, r.id))
      .orderBy(desc(llmAnalyses.createdAt))
      .limit(1);
    picked.push({ brewLogId: r.id, timestamp: r.timestamp.toISOString(), rating: r.rating, drinkRating: r.drinkRating, tastingNotes: r.tastingNotes, problems: problems.map((p) => p.name), stored: stored ?? null });
  }
  writeJson("brews.json", picked);
  console.log(`Picked ${picked.length} rated brews → eval/brews.json`);
}

// A job to send: what goes in (for its size) and the call.
interface EvalJob {
  input: unknown;
  send: () => Promise<{ output: unknown; usage: { promptTokens: number; completionTokens: number } | null }>;
}

async function analysisJobs(brews: Picked[]): Promise<Array<EvalJob | null>> {
  const { loadBrewContext } = await import("./context.js");
  const { requestAnalysis } = await import("./llm.js");
  const { toLlmInput } = await import("./prompt.js");
  return Promise.all(
    brews.map(async (b) => {
      const context = await loadBrewContext(b.brewLogId);
      // What's actually sent: the compact input (prompt.ts), not the full context.
      return context ? { input: toLlmInput(context), send: async () => { const r = await requestAnalysis(context); return { output: r.analysis, usage: r.usage }; } } : null;
    }),
  );
}

async function suggestJobs(brews: Picked[], source: string): Promise<Array<EvalJob | null>> {
  const { db } = await import("./db.js");
  const { brewLogs, SUGGEST_SOURCES } = await import("@barista/shared/schema");
  const { eq } = await import("drizzle-orm");
  const { loadSuggestContext } = await import("./suggestContext.js");
  const { requestSuggestion } = await import("./llm.js");
  const { toSuggestInput } = await import("./prompt.js");
  const picked = SUGGEST_SOURCES.find((s) => s === source);
  if (!picked) throw new Error(`--suggest takes one of ${SUGGEST_SOURCES.join(", ")}`);
  return Promise.all(
    brews.map(async (b) => {
      const [brew] = await db.select().from(brewLogs).where(eq(brewLogs.id, b.brewLogId));
      if (!brew) return null;
      // The batch the barista went on to brew (espresso has no water: its yield is the shot).
      const espresso = brew.actualWaterGrams === null;
      const request = {
        beanId: brew.beanId,
        recipeId: brew.recipeId,
        brewerId: brew.brewerId,
        grinderId: brew.grinderId,
        source: picked,
        maxBrews: 5,
        batchDoseGrams: brew.actualDoseGrams,
        batchWaterGrams: brew.actualWaterGrams,
        batchIceGrams: brew.actualIceGrams,
        batchYieldGrams: espresso ? brew.actualYieldGrams : null,
      };
      const context = await loadSuggestContext(request, { before: brew.timestamp });
      return context ? { input: toSuggestInput(context), send: async () => { const r = await requestSuggestion(context); return { output: r.suggestion, usage: r.usage }; } } : null;
    }),
  );
}

async function run(label: string, yes: boolean, suggest: string | null): Promise<void> {
  const { PROMPT_VERSION } = await import("./llm.js");
  const { config } = await import("./config.js");
  const brews = readJson<Picked[]>("brews.json");
  const jobs = suggest === null ? await analysisJobs(brews) : await suggestJobs(brews, suggest);
  const inputs = jobs.map((j) => j?.input ?? null);
  const chars = inputs.reduce<number>((n, c) => n + (c ? JSON.stringify(c).length : 0), 0);
  console.log(`${brews.length} brews${suggest === null ? "" : ` (Suggest parameters, ${suggest})`}, prompt ${PROMPT_VERSION}, model ${config.openaiModel}: about ${Math.round(chars / 4).toLocaleString()} context tokens plus the prompt each time.`);
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Send them to the API? [y/N] ");
    rl.close();
    if (!/^y/i.test(answer)) return;
  }
  const out: RunResult = { label, promptVersion: PROMPT_VERSION, model: config.openaiModel, at: new Date().toISOString(), results: [] };
  for (const [i, b] of brews.entries()) {
    const job = jobs[i];
    if (!job) {
      out.results.push({ brewLogId: b.brewLogId, contextChars: 0, context: null, output: null, usage: null, error: "brew no longer exists" });
      continue;
    }
    try {
      const { output, usage } = await job.send();
      out.results.push({ brewLogId: b.brewLogId, contextChars: JSON.stringify(inputs[i]).length, context: inputs[i], output, usage, error: null });
      process.stdout.write(".");
    } catch (err) {
      out.results.push({ brewLogId: b.brewLogId, contextChars: JSON.stringify(inputs[i]).length, context: inputs[i], output: null, usage: null, error: err instanceof Error ? err.message : String(err) });
      process.stdout.write("x");
    }
  }
  writeJson(`${label}.json`, out);
  const tokens = out.results.reduce((n, r) => n + (r.usage?.promptTokens ?? 0), 0);
  console.log(`\nSaved eval/${label}.json (${tokens.toLocaleString()} prompt tokens in all).`);
}

function compare(a: string, b: string): void {
  const brews = readJson<Picked[]>("brews.json");
  const A = readJson<RunResult>(`${a}.json`);
  const B = readJson<RunResult>(`${b}.json`);
  const find = (r: RunResult, id: string) => r.results.find((x) => x.brewLogId === id);
  const sum = (r: RunResult, f: (x: RunResult["results"][number]) => number) => r.results.reduce((n, x) => n + f(x), 0);
  const cell = (s: unknown) => String(s ?? "–").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const show = (o: unknown) => {
    if (!o || typeof o !== "object") return "–";
    const x = o as Record<string, unknown>;
    // A suggestion's values, or an analysis's changes.
    // (Runs from before the ratio gave dose → water or shot weight.)
    const amounts = "ratio" in x ? `ratio ${x.ratio ?? "kept"}` : `${x.doseGrams} g → ${x.waterGrams ?? x.yieldGrams ?? "–"} g`;
    const values = "ratio" in x || "doseGrams" in x
      ? [`grind ${x.grindSetting ?? "–"}${x.grindRpm ? ` at ${x.grindRpm} rpm` : ""}, ${x.tempC ?? "–"} °C, ${amounts}`]
      : [`grind ${x.suggestedGrindDelta}, temp ${x.suggestedTempDelta}`];
    return [x.nextStep ? `**Next:** ${x.nextStep}` : null, ...values, x.suggestedRpmDelta ? `rpm ${x.suggestedRpmDelta}` : null, x.suggestedDoseDelta ? `dose ${x.suggestedDoseDelta} g` : null, x.suggestedYieldDelta ? `shot weight ${x.suggestedYieldDelta} g` : null, x.confidence ? `(${x.confidence})` : null, `“${x.reasoning}”`]
      .filter(Boolean)
      .join("<br>");
  };
  // A suggestion's batch, which it keeps.
  const batchLine = (...contexts: unknown[]): string[] => {
    const batch = contexts.map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>).batch : undefined)).find((b) => b && typeof b === "object");
    if (!batch) return [];
    const t = batch as Record<string, number | undefined>;
    return [`Batch: ${t.doseGrams ?? "–"} g → ${t.waterGrams ?? t.yieldGrams ?? "–"} g${t.iceGrams ? ` + ${t.iceGrams} g ice` : ""}, ratio ${t.ratio ?? "–"}`];
  };
  const lines = [
    `# ${a} vs ${b}`,
    "",
    `| | ${a} | ${b} |`,
    "|---|---|---|",
    `| Prompt version | ${A.promptVersion} | ${B.promptVersion} |`,
    `| Model | ${A.model} | ${B.model} |`,
    `| Prompt tokens (all brews) | ${sum(A, (x) => x.usage?.promptTokens ?? 0).toLocaleString()} | ${sum(B, (x) => x.usage?.promptTokens ?? 0).toLocaleString()} |`,
    `| Output tokens (all brews) | ${sum(A, (x) => x.usage?.completionTokens ?? 0).toLocaleString()} | ${sum(B, (x) => x.usage?.completionTokens ?? 0).toLocaleString()} |`,
    `| Context size (chars) | ${sum(A, (x) => x.contextChars).toLocaleString()} | ${sum(B, (x) => x.contextChars).toLocaleString()} |`,
    `| Errors | ${A.results.filter((x) => x.error).length} | ${B.results.filter((x) => x.error).length} |`,
    "",
  ];
  for (const brew of brews) {
    const x = find(A, brew.brewLogId);
    const y = find(B, brew.brewLogId);
    lines.push(
      `## ${brew.timestamp.slice(0, 16).replace("T", " ")}`,
      "",
      `Rating ${brew.rating ?? "–"}${brew.drinkRating ? ` (drink ${brew.drinkRating})` : ""} · ${cell(brew.tastingNotes)}${brew.problems.length ? ` · problems: ${brew.problems.join(", ")}` : ""}`,
      ...batchLine(x?.context, y?.context),
      brew.stored ? `Stored analysis${brew.stored.helpful === null ? "" : brew.stored.helpful ? " (rated 👍)" : " (rated 👎)"}: “${cell(brew.stored.reasoning)}”` : "No stored analysis.",
      "",
      `| ${a} | ${b} |`,
      "|---|---|",
      `| ${x?.error ? `error: ${cell(x.error)}` : show(x?.output)} | ${y?.error ? `error: ${cell(y.error)}` : show(y?.output)} |`,
      "",
    );
  }
  const file = `compare-${a}-${b}.md`;
  writeFileSync(path.join(OUT, file), lines.join("\n"));
  console.log(`Wrote eval/${file}`);
}

async function main(args: string[]): Promise<void> {
  useRootEnv();
  if (!existsSync(OUT)) mkdirSync(OUT);
  const [command] = args;
  if (command === "snapshot") await snapshot(Number(flag(args, "limit") ?? 12));
  else if (command === "run" && flag(args, "label")) {
    const next = flag(args, "suggest"); // the source, if one follows
    const suggest = !args.includes("--suggest") ? null : next && !next.startsWith("--") ? next : "beanRecipe";
    await run(flag(args, "label")!, args.includes("--yes"), suggest);
  }
  else if (command === "compare" && args[1] && args[2]) compare(args[1], args[2]);
  else {
    console.error("Usage: snapshot [--limit N] | run --label NAME [--suggest [SOURCE]] [--yes] | compare A B");
    process.exitCode = 2;
  }
}

main(process.argv.slice(2))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { pool } = await import("./db.js").catch(() => ({ pool: null }));
    await pool?.end();
  });
