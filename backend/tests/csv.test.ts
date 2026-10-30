import { describe, expect, it } from "vitest";
import { toCsv } from "../src/csv.js";
import { addMember, brewerId, newBean, newBrewLog, newUser, newWorkspace, processId, styleId } from "./helpers.js";

// Rows of a CSV the export wrote (quotes and commas inside quotes handled).
function parse(csv: string): string[][] {
  expect(csv.startsWith("﻿")).toBe(true);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = csv.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      (row = []), (cell = ""), i++;
    } else cell += c;
  }
  return rows;
}
const asObjects = (csv: string) => {
  const [header, ...rows] = parse(csv);
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i]])));
};

describe("CSV export (docs/api/backup.md §2b, CSV)", () => {
  it("quotes what needs it and keeps formulas as text", () => {
    const csv = toCsv(["a", "b", "c", "d", "e"], [["plain", 'say "hi", twice', "line\nbreak", "=SUM(A1)", -2], [null, true, false, 1.5, "-tart"]]);
    expect(csv).toBe('﻿a,b,c,d,e\r\nplain,"say ""hi"", twice","line\nbreak",\'=SUM(A1),-2\r\n,yes,no,1.5,\'-tart\r\n');
  });

  it("writes the journal with names, worked-out figures, prep and problems", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const base = `/api/workspaces/${ws.id}`;
    const c40 = (await owner.agent.post(`${base}/grinders`).send({ name: "C40" })).body.grinder.id;
    const [v60, pourOver] = [await brewerId(owner, ws.id, "V60"), await styleId(owner, ws.id, "filter", "pour_over")];
    const recipe = (await owner.agent.post(`${base}/recipes`).send({ name: "House V60", brewerId: v60, styleId: pourOver, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id;
    const tools = (await owner.agent.get(`${base}/prep-tools`)).body.tools as Array<{ id: string; name: string }>;
    const problems = (await owner.agent.get(`${base}/brew-problems`)).body.problems as Array<{ id: string; name: string }>;
    const bean = await newBean(owner, ws.id, { roasterName: "Onyx", beanName: "Monarch" });
    await newBrewLog(owner, ws.id, bean, {
      recipeId: recipe,
      grinderId: c40,
      actualGrindSetting: 21,
      actualYieldGrams: 220,
      tdsPercent: 1.38,
      actualTimeSec: 185,
      timestamp: "2026-10-20T15:30:00.000Z",
      utcOffsetMinutes: -420,
      toolIds: [tools.find((t) => t.name === "RDT")!.id],
      problemIds: [problems.find((p) => p.name === "Fast drawdown")!.id],
      flavors: ["off.harsh.bitter", "fruity.citrus.lemon"],
      rating: 4,
      tastingNotes: "Sweet, a bit thin",
    });
    await newBrewLog(owner, ws.id, bean, { timestamp: "2026-10-21T08:00:00.000Z", rating: 3.5 });

    const res = await owner.agent.get(`${base}/csv/brew_logs`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(new RegExp(`attachment; filename="${ws.slug}-journal-\\d{4}-\\d{2}-\\d{2}\\.csv"`));
    const [newest, older] = asObjects(res.text);
    expect(newest!.Date).toBe("2026-10-21 08:00");
    expect(newest!.Rating).toBe("3.5"); // half steps (docs/api/brew-logs.md §6)
    expect(older).toMatchObject({
      Date: "2026-10-20 08:30", // the brewing device's local time
      "Date (UTC)": "2026-10-20T15:30:00.000Z",
      "Brewed by": owner.email,
      Roaster: "Onyx",
      Bean: "Monarch",
      Recipe: "House V60",
      Style: "Pour over",
      Brewer: "V60",
      Grinder: "C40",
      "Grind setting": "21",
      "Dose (g)": "15",
      "Water (g)": "250",
      "Ice (g)": "",
      "Yield (g)": "220",
      Ratio: "16.7",
      "TDS (%)": "1.38",
      "Extraction (%)": "20.2",
      "Time (s)": "185",
      Time: "3:05",
      Steeping: "no",
      Prep: "RDT",
      Problems: "Fast drawdown",
      Rating: "4",
      Flavors: "Lemon; Bitter", // wheel order, by label
      "Tasting notes": "Sweet, a bit thin",
    });
  });

  it("counts the ice of a flash chilled brew in its ratio (docs/api/recipes.md §5)", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const bean = await newBean(owner, ws.id);
    await newBrewLog(owner, ws.id, bean, { actualWaterGrams: 150, actualIceGrams: 100, actualYieldGrams: 228 });
    const [row] = asObjects((await owner.agent.get(`/api/workspaces/${ws.id}/csv/brew_logs`)).text);
    expect(row).toMatchObject({ "Water (g)": "150", "Ice (g)": "100", "Yield (g)": "228", Ratio: "16.7", "Extraction (%)": "" });
  });

  it("writes the beans with their process and how often they were brewed", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const washed = await processId(owner, ws.id, "washed");
    const bean = await newBean(owner, ws.id, { roasterName: "Onyx", beanName: "Monarch", processId: washed, roastDate: "2026-10-01", decaf: true, varieties: ["SL28", "SL34"], species: ["arabica"] });
    await newBean(owner, ws.id, { roasterName: "Sey", beanName: "Gatomboya" });
    await newBrewLog(owner, ws.id, bean);
    await newBrewLog(owner, ws.id, bean);
    const res = await owner.agent.get(`/api/workspaces/${ws.id}/csv/beans`);
    expect(res.status).toBe(200);
    const rows = asObjects(res.text);
    expect(rows.find((r) => r.Bean === "Monarch")).toMatchObject({ Roaster: "Onyx", Process: "Washed", "Roast date": "2026-10-01", Decaf: "yes", Varieties: "SL28, SL34", Species: "arabica", Brews: "2", Archived: "" });
    expect(rows.find((r) => r.Bean === "Gatomboya")).toMatchObject({ Brews: "0", Process: "" });
  });

  it("is for owners only, and only for these lists", async () => {
    const owner = await newUser();
    const ws = await newWorkspace(owner);
    const barista = await newUser();
    await addMember(owner, ws.id, barista, "barista");
    expect((await barista.agent.get(`/api/workspaces/${ws.id}/csv/brew_logs`)).status).toBe(403);
    expect((await owner.agent.get(`/api/workspaces/${ws.id}/csv/recipes`)).status).toBe(404);
    const empty = await owner.agent.get(`/api/workspaces/${ws.id}/csv/brew_logs`);
    expect(parse(empty.text)).toHaveLength(1); // just the header
  });
});
