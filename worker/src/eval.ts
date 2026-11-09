// Compare prompt versions on real brews (docs/api/llm-contract.md §9,
// "Evaluating changes"). Run on the host from the repo root; it reads the
// root .env (database password, OpenAI key and model), only reads the
// database, and writes to eval/ (git-ignored: it's your brews).
//
//   npm run eval -w worker -- snapshot [--limit 12] [--with-flavors]   choose the brews
//   npm run eval -w worker -- run --label baseline [--yes] [--without flavors|places]
//   npm run eval -w worker -- run --label sug --suggest [beanRecipe] [--yes]
//   npm run eval -w worker -- compare baseline after
//   npm run eval -w worker -- propose --label before [--limit 8] [--yes]
//   npm run eval -w worker -- compare-propose before after
//   npm run eval -w worker -- recap --label before [--weeks 4] [--yes]
//
// `run` builds each brew's context with the code as it is now and sends it
// through the prompt as it is now, so run it before and after a change.
// With --suggest it asks "Suggest parameters" instead, as if setting up each
// brew (its bean, recipe, brewer and grinder; brews before it, from the
// source given, default beanRecipe), so the values can be held against the
// brew as it went.
// `propose` asks the chat, with each recipe attached, for a variation as a new
// recipe, and keeps the proposals with the step checks they fail
// (@barista/shared/recipeChecks): the recipes brewed most recently first.
// `recap` writes the AI summary (§9f) for each of the last whole weeks of
// whoever brewed most, in their busiest workspace, honouring its hidden
// details: a JSON file and a Markdown one to read them side by side.
// --with-flavors picks only brews with wheel flavors; --without flavors
// sends them with none (and so no flavors section in the prompt), --without
// places with their labels only, to see what the picks change (backlog 10).
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
  flavors?: string[]; // as sent; missing in snapshots from before
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

async function snapshot(limit: number, withFlavors: boolean): Promise<void> {
  const { db } = await import("./db.js");
  const { brewLogs, brewLogFlavors, brewLogProblems, brewProblems, llmAnalyses } = await import("@barista/shared/schema");
  const { and, desc, eq, inArray, isNotNull, or } = await import("drizzle-orm");
  const { flavorsFor } = await import("./context.js");
  const rows = await db
    .select({ id: brewLogs.id, timestamp: brewLogs.timestamp, rating: brewLogs.rating, drinkRating: brewLogs.drinkRating, tastingNotes: brewLogs.tastingNotes })
    .from(brewLogs)
    .where(and(
      eq(brewLogs.steeping, false),
      or(isNotNull(brewLogs.rating), isNotNull(brewLogs.drinkRating)),
      withFlavors ? inArray(brewLogs.id, db.selectDistinct({ id: brewLogFlavors.brewLogId }).from(brewLogFlavors)) : undefined,
    ))
    .orderBy(desc(brewLogs.timestamp))
    .limit(limit);
  const flavors = await flavorsFor(rows.map((r) => r.id));
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
    picked.push({ brewLogId: r.id, timestamp: r.timestamp.toISOString(), rating: r.rating, drinkRating: r.drinkRating, tastingNotes: r.tastingNotes, problems: problems.map((p) => p.name), flavors: flavors.get(r.id) ?? [], stored: stored ?? null });
  }
  writeJson("brews.json", picked);
  console.log(`Picked ${picked.length} rated brews${withFlavors ? " with flavors" : ""} → eval/brews.json`);
}

// A job to send: what goes in (for its size) and the call.
interface EvalJob {
  input: unknown;
  send: () => Promise<{ output: unknown; usage: { promptTokens: number; completionTokens: number } | null }>;
}

// What --without leaves out of each brew's flavors.
type Without = "flavors" | "places";
const WITHOUT: readonly Without[] = ["flavors", "places"];
// A place is the last "(…)" flavorLabel adds; a label that itself ends in
// one would lose it too, which is fine for an eval.
const trimFlavors = (flavors: string[], without: Without | null): string[] =>
  without === "flavors" ? [] : without === "places" ? flavors.map((f) => f.replace(/ \([^()]*\)$/, "")) : flavors;

async function analysisJobs(brews: Picked[], without: Without | null): Promise<Array<EvalJob | null>> {
  const { loadBrewContext } = await import("./context.js");
  const { requestAnalysis } = await import("./llm.js");
  const { resolveAi } = await import("./ai/resolve.js");
  const { toLlmInput } = await import("./prompt.js");
  return Promise.all(
    brews.map(async (b) => {
      const context = await loadBrewContext(b.brewLogId);
      if (context) context.brew.flavors = trimFlavors(context.brew.flavors, without);
      // What's actually sent: the compact input (prompt.ts), not the full context.
      return context ? { input: toLlmInput(context), send: async () => { const r = await requestAnalysis(await resolveAi(), context); return { output: r.analysis, usage: r.usage }; } } : null;
    }),
  );
}

async function suggestJobs(brews: Picked[], source: string, without: Without | null): Promise<Array<EvalJob | null>> {
  const { db } = await import("./db.js");
  const { brewLogs, SUGGEST_SOURCES } = await import("@barista/shared/schema");
  const { eq } = await import("drizzle-orm");
  const { loadSuggestContext } = await import("./suggestContext.js");
  const { requestSuggestion } = await import("./llm.js");
  const { resolveAi } = await import("./ai/resolve.js");
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
        alternativesAsked: [], // the values only
      };
      const context = await loadSuggestContext(request, { before: brew.timestamp });
      for (const past of context?.brews ?? []) past.flavors = trimFlavors(past.flavors, without);
      return context ? { input: toSuggestInput(context), send: async () => { const r = await requestSuggestion(await resolveAi(), context); return { output: r.suggestion, usage: r.usage }; } } : null;
    }),
  );
}

async function run(label: string, yes: boolean, suggest: string | null, without: Without | null): Promise<void> {
  const { PROMPT_VERSION } = await import("./llm.js");
  const { config } = await import("./config.js");
  const brews = readJson<Picked[]>("brews.json");
  const jobs = suggest === null ? await analysisJobs(brews, without) : await suggestJobs(brews, suggest, without);
  const inputs = jobs.map((j) => j?.input ?? null);
  const chars = inputs.reduce<number>((n, c) => n + (c ? JSON.stringify(c).length : 0), 0);
  console.log(`${brews.length} brews${suggest === null ? "" : ` (Suggest parameters, ${suggest})`}${without ? ` without ${without}` : ""}, prompt ${PROMPT_VERSION}, model ${config.openaiModel}: about ${Math.round(chars / 4).toLocaleString()} context tokens plus the prompt each time.`);
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Send them to the API? [y/N] ");
    rl.close();
    if (!/^y/i.test(answer)) return;
  }
  const out: RunResult = { label, promptVersion: PROMPT_VERSION, model: config.openaiModel ?? "", at: new Date().toISOString(), results: [] };
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

// ---- Chat recipe proposals ---------------------------------------------------

const PROPOSE_ASK = "Propose a variation of this recipe as a new recipe, with its full steps.";
interface ProposeResult {
  label: string;
  chatPromptVersion: string;
  model: string;
  at: string;
  ask: string;
  results: Array<{
    recipeId: string;
    recipe: string;
    brewer: string;
    reply: string | null; // the text, without the blocks
    blocks: unknown[]; // the proposal blocks as written, before checking
    proposals: unknown[]; // as saved, warnings included
    usage: { promptTokens: number; completionTokens: number } | null;
    error: string | null;
  }>;
}

async function propose(label: string, limit: number, yes: boolean): Promise<void> {
  const { db } = await import("./db.js");
  const { brewers, brewLogs, recipes } = await import("@barista/shared/schema");
  const { and, desc, eq, isNull, max } = await import("drizzle-orm");
  const { CHAT_PROMPT_VERSION } = await import("./prompt.js");
  const { buildChatRequest, complete } = await import("./llm.js");
  const { resolveAi } = await import("./ai/resolve.js");
  const { loadAttachments } = await import("./chat.js");
  const { checkProposals, refTable, splitProposals } = await import("./chatProposals.js");
  // Active recipes, the ones brewed most recently first.
  const picked = await db
    .select({ id: recipes.id, name: recipes.name, workspaceId: recipes.workspaceId, brewer: brewers.name, last: max(brewLogs.timestamp) })
    .from(recipes)
    .innerJoin(brewers, eq(recipes.brewerId, brewers.id))
    .leftJoin(brewLogs, eq(brewLogs.recipeId, recipes.id))
    .where(and(isNull(recipes.archivedAt), isNull(brewers.archivedAt)))
    .groupBy(recipes.id, recipes.name, recipes.workspaceId, brewers.name)
    .orderBy(desc(max(brewLogs.timestamp)))
    .limit(limit);
  const ai = await resolveAi();
  console.log(`${picked.length} recipes (${picked.map((r) => r.name).join(", ")}), chat prompt ${CHAT_PROMPT_VERSION}, model ${ai.models.main}: one chat reply each.`);
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Send them to the API? [y/N] ");
    rl.close();
    if (!/^y/i.test(answer)) return;
  }
  const out: ProposeResult = { label, chatPromptVersion: CHAT_PROMPT_VERSION, model: ai.models.main, at: new Date().toISOString(), ask: PROPOSE_ASK, results: [] };
  for (const r of picked) {
    const attachments = [{ kind: "recipe" as const, id: r.id, label: r.name }];
    const base = { recipeId: r.id, recipe: r.name, brewer: r.brewer };
    try {
      const attached = await loadAttachments(attachments, r.workspaceId);
      const request = buildChatRequest(ai.models.main, [{ role: "user", content: PROPOSE_ASK }], undefined, attached);
      const { message, usage } = await complete(ai, request);
      const { text, blocks } = splitProposals(message?.content ?? "");
      const proposals = checkProposals(blocks, await refTable(attachments, r.workspaceId));
      out.results.push({ ...base, reply: text, blocks, proposals, usage, error: null });
      process.stdout.write(".");
    } catch (err) {
      out.results.push({ ...base, reply: null, blocks: [], proposals: [], usage: null, error: err instanceof Error ? err.message : String(err) });
      process.stdout.write("x");
    }
  }
  writeJson(`propose-${label}.json`, out);
  const flagged = out.results.filter((x) => x.proposals.some((p) => (p as { warnings?: string[] }).warnings?.length)).length;
  const dropped = out.results.reduce((n, x) => n + Math.max(0, Math.min(x.blocks.length, 3) - x.proposals.length), 0);
  console.log(`\nSaved eval/propose-${label}.json: ${out.results.filter((x) => x.proposals.length).length} with a proposal, ${flagged} flagged, ${dropped} block(s) dropped by the checks.`);
}

async function recap(label: string, weeks: number, yes: boolean): Promise<void> {
  const { db } = await import("./db.js");
  const { brewLogs, DEFAULT_PREFERENCES, DEFAULT_WORKSPACE_SETTINGS, users, withDefaults, workspaces } = await import("@barista/shared/schema");
  const { count, desc, eq } = await import("drizzle-orm");
  const { justEnded, periodLabel, previousPeriod } = await import("@barista/shared/recapPeriods");
  const { RECAP_PROMPT_VERSION, toPeriodInput } = await import("./prompt.js");
  const { requestRecapSummary } = await import("./llm.js");
  const { resolveAi } = await import("./ai/resolve.js");
  const { loadPeriodContext } = await import("./periodContext.js");
  const { promptFor } = await import("./processor.js");
  const [busiest] = await db
    .select({ userId: brewLogs.userId, workspaceId: brewLogs.workspaceId, n: count() })
    .from(brewLogs)
    .groupBy(brewLogs.userId, brewLogs.workspaceId)
    .orderBy(desc(count()))
    .limit(1);
  if (!busiest?.userId) throw new Error("No brews to summarise");
  const [person] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, busiest.userId));
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, busiest.workspaceId));
  const prefs = withDefaults(DEFAULT_PREFERENCES, person?.preferences ?? null);
  const hidden = new Set(withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws?.settings ?? null).aiHidden);
  const periods = [justEnded("weekly", new Date().toISOString().slice(0, 10), prefs.weekStartsOn)];
  while (periods.length < weeks) periods.push(previousPeriod("weekly", periods.at(-1)!, prefs.weekStartsOn));
  const contexts = [];
  for (const p of periods) {
    const ctx = await loadPeriodContext({ workspaceId: busiest.workspaceId, userId: busiest.userId, kind: "weekly", period: p, previous: previousPeriod("weekly", p, prefs.weekStartsOn) });
    if (ctx.figures.brews) contexts.push({ ...ctx, period: p });
  }
  const ai = await resolveAi(busiest.workspaceId);
  console.log(`${contexts.length} weeks with brews (${contexts.map((c) => periodLabel("weekly", c.period)).join(", ")}), recap prompt ${RECAP_PROMPT_VERSION}, model ${ai.models.main}: one call each.`);
  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Send them to the API? [y/N] ");
    rl.close();
    if (!/^y/i.test(answer)) return;
  }
  const custom = await promptFor(busiest.userId, null);
  const results = [];
  for (const ctx of contexts) {
    const input = toPeriodInput(ctx, hidden);
    try {
      const { summary, usage } = await requestRecapSummary(ai, ctx, hidden, custom);
      results.push({ period: ctx.period, brews: ctx.figures.brews, inputChars: JSON.stringify(input).length, input, output: summary, usage, error: null });
      process.stdout.write(".");
    } catch (err) {
      results.push({ period: ctx.period, brews: ctx.figures.brews, inputChars: JSON.stringify(input).length, input, output: null, usage: null, error: err instanceof Error ? err.message : String(err) });
      process.stdout.write("x");
    }
  }
  writeJson(`recap-${label}.json`, { label, recapPromptVersion: RECAP_PROMPT_VERSION, model: ai.models.main, at: new Date().toISOString(), results });
  const md = results
    .map((r) => {
      const head = `## ${periodLabel("weekly", r.period)} · ${r.brews} brews · ${r.inputChars} chars in · ${r.usage ? `${r.usage.promptTokens}+${r.usage.completionTokens} tokens` : "no usage"}`;
      return r.output ? `${head}\n\n${r.output.summary}\n\n${r.output.highlights.map((h) => `- ${h}`).join("\n")}` : `${head}\n\nError: ${r.error}`;
    })
    .join("\n\n");
  writeFileSync(path.join(OUT, `recap-${label}.md`), `# Recap summaries: ${label} (${RECAP_PROMPT_VERSION}, ${ai.models.main})\n\n${md}\n`);
  console.log(`\nSaved eval/recap-${label}.json and .md`);
}

function comparePropose(a: string, b: string): void {
  const A = readJson<ProposeResult>(`propose-${a}.json`);
  const B = readJson<ProposeResult>(`propose-${b}.json`);
  type Row = ProposeResult["results"][number];
  type Shown = { kind?: string; recipe?: Record<string, unknown>; changes?: Record<string, unknown>; warnings?: string[] };
  const warnings = (r: ProposeResult) => r.results.flatMap((x) => (x.proposals as Shown[]).flatMap((p) => p.warnings ?? []));
  // A warning's kind: its wording without the numbers.
  const kinds = (ws: string[]) => {
    const counts = new Map<string, number>();
    for (const w of ws) {
      const k = w.replace(/Step \d+/, "Step N").replace(/[\d.:–]+/g, "#");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts].map(([k, n]) => `${n} × ${k}`);
  };
  const steps = (p: Shown) => {
    const r = p.recipe ?? p.changes ?? {};
    const list = (r.steps as Array<Record<string, unknown>> | undefined) ?? [];
    const head = `${p.kind ?? "?"}: ${r.name ?? ""} ${r.targetDoseGrams ?? "–"} g → ${r.targetWaterGrams ?? r.expectedYieldGrams ?? "–"} g, window ${r.expectedFinishMinSec ?? "–"}–${r.expectedFinishMaxSec ?? "–"} s`;
    const body = list.map((s) => `${s.stepType} ${s.durationSec ?? "–"} s${s.targetWaterGrams != null ? ` → ${s.targetWaterGrams} g` : ""}`).join(", ");
    const flags = p.warnings?.length ? `<br>⚠ ${p.warnings.join("<br>⚠ ")}` : "";
    return `${head}<br>${body || "no steps"}${flags}`;
  };
  const cell = (x: Row | undefined) => (!x ? "–" : x.error ? `error: ${x.error}` : x.proposals.length ? (x.proposals as Shown[]).map(steps).join("<hr>") : "no proposal");
  const lines = [
    `# Chat recipe proposals: ${a} vs ${b}`,
    "",
    `Asked: “${A.ask}”`,
    "",
    `| | ${a} | ${b} |`,
    "|---|---|---|",
    `| Chat prompt | ${A.chatPromptVersion} | ${B.chatPromptVersion} |`,
    `| Model | ${A.model} | ${B.model} |`,
    `| Recipes with a proposal | ${A.results.filter((x) => x.proposals.length).length}/${A.results.length} | ${B.results.filter((x) => x.proposals.length).length}/${B.results.length} |`,
    `| Blocks written / kept | ${A.results.reduce((n, x) => n + (x.blocks?.length ?? 0), 0)} / ${A.results.reduce((n, x) => n + x.proposals.length, 0)} | ${B.results.reduce((n, x) => n + (x.blocks?.length ?? 0), 0)} / ${B.results.reduce((n, x) => n + x.proposals.length, 0)} |`,
    `| Proposals flagged | ${A.results.filter((x) => (x.proposals as Shown[]).some((p) => p.warnings?.length)).length} | ${B.results.filter((x) => (x.proposals as Shown[]).some((p) => p.warnings?.length)).length} |`,
    `| Warnings | ${warnings(A).length} | ${warnings(B).length} |`,
    `| Output tokens | ${A.results.reduce((n, x) => n + (x.usage?.completionTokens ?? 0), 0).toLocaleString()} | ${B.results.reduce((n, x) => n + (x.usage?.completionTokens ?? 0), 0).toLocaleString()} |`,
    "",
    `**${a}:** ${kinds(warnings(A)).join("; ") || "none"}`,
    "",
    `**${b}:** ${kinds(warnings(B)).join("; ") || "none"}`,
    "",
  ];
  for (const x of A.results) {
    const y = B.results.find((r) => r.recipeId === x.recipeId);
    lines.push(`## ${x.recipe} (${x.brewer})`, "", `| ${a} | ${b} |`, "|---|---|", `| ${cell(x)} | ${cell(y)} |`, "");
  }
  const file = `compare-propose-${a}-${b}.md`;
  writeFileSync(path.join(OUT, file), lines.join("\n"));
  console.log(`Wrote eval/${file}`);
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
      `Rating ${brew.rating ?? "–"}${brew.drinkRating ? ` (drink ${brew.drinkRating})` : ""} · ${cell(brew.tastingNotes)}${brew.problems.length ? ` · problems: ${brew.problems.join(", ")}` : ""}${brew.flavors?.length ? ` · flavors: ${brew.flavors.join(", ")}` : ""}`,
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
  if (command === "snapshot") await snapshot(Number(flag(args, "limit") ?? 12), args.includes("--with-flavors"));
  else if (command === "run" && flag(args, "label")) {
    const next = flag(args, "suggest"); // the source, if one follows
    const suggest = !args.includes("--suggest") ? null : next && !next.startsWith("--") ? next : "beanRecipe";
    const leaveOut = flag(args, "without");
    const without = WITHOUT.find((w) => w === leaveOut) ?? null;
    if (leaveOut !== undefined && !without) throw new Error(`--without takes one of ${WITHOUT.join(", ")}`);
    await run(flag(args, "label")!, args.includes("--yes"), suggest, without);
  }
  else if (command === "compare" && args[1] && args[2]) compare(args[1], args[2]);
  else if (command === "propose" && flag(args, "label")) await propose(flag(args, "label")!, Number(flag(args, "limit") ?? 8), args.includes("--yes"));
  else if (command === "compare-propose" && args[1] && args[2]) comparePropose(args[1], args[2]);
  else if (command === "recap" && flag(args, "label")) await recap(flag(args, "label")!, Number(flag(args, "weeks") ?? 4), args.includes("--yes"));
  else {
    console.error("Usage: snapshot [--limit N] [--with-flavors] | run --label NAME [--suggest [SOURCE]] [--without flavors|places] [--yes] | compare A B | propose --label NAME [--limit N] [--yes] | compare-propose A B | recap --label NAME [--weeks N] [--yes]");
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
