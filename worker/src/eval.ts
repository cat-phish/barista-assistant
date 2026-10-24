// Compare prompt versions on real brews (docs/api/llm-contract.md §9,
// "Evaluating changes"). Run on the host from the repo root; it reads the
// root .env (database password, OpenAI key and model), only reads the
// database, and writes to eval/ (git-ignored: it's your brews).
//
//   npm run eval -w worker -- snapshot [--limit 12]   choose the brews
//   npm run eval -w worker -- run --label baseline [--yes]
//   npm run eval -w worker -- compare baseline after
//
// `run` builds each brew's context with the code as it is now and sends it
// through the prompt as it is now, so run it before and after a change.
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
    contextChars: number;
    context: unknown;
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

async function run(label: string, yes: boolean): Promise<void> {
  const { loadBrewContext } = await import("./context.js");
  const { requestAnalysis, PROMPT_VERSION } = await import("./llm.js");
  const { config } = await import("./config.js");
  const brews = readJson<Picked[]>("brews.json");
  const contexts = await Promise.all(brews.map((b) => loadBrewContext(b.brewLogId)));
  const chars = contexts.reduce((n, c) => n + (c ? JSON.stringify(c).length : 0), 0);
  console.log(`${brews.length} brews, prompt ${PROMPT_VERSION}, model ${config.openaiModel}: about ${Math.round(chars / 4).toLocaleString()} context tokens plus the prompt each time.`);
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Send them to the API? [y/N] ");
    rl.close();
    if (!/^y/i.test(answer)) return;
  }
  const out: RunResult = { label, promptVersion: PROMPT_VERSION, model: config.openaiModel, at: new Date().toISOString(), results: [] };
  for (const [i, b] of brews.entries()) {
    const context = contexts[i];
    if (!context) {
      out.results.push({ brewLogId: b.brewLogId, contextChars: 0, context: null, output: null, usage: null, error: "brew no longer exists" });
      continue;
    }
    try {
      const { analysis, usage } = await requestAnalysis(context);
      out.results.push({ brewLogId: b.brewLogId, contextChars: JSON.stringify(context).length, context, output: analysis, usage, error: null });
      process.stdout.write(".");
    } catch (err) {
      out.results.push({ brewLogId: b.brewLogId, contextChars: JSON.stringify(context).length, context, output: null, usage: null, error: err instanceof Error ? err.message : String(err) });
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
    return [x.nextStep ? `**Next:** ${x.nextStep}` : null, `grind ${x.suggestedGrindDelta}, temp ${x.suggestedTempDelta}`, x.suggestedRpmDelta ? `rpm ${x.suggestedRpmDelta}` : null, x.confidence ? `(${x.confidence})` : null, `“${x.reasoning}”`]
      .filter(Boolean)
      .join("<br>");
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
  else if (command === "run" && flag(args, "label")) await run(flag(args, "label")!, args.includes("--yes"));
  else if (command === "compare" && args[1] && args[2]) compare(args[1], args[2]);
  else {
    console.error("Usage: snapshot [--limit N] | run --label NAME [--yes] | compare A B");
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
