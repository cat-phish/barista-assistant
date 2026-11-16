import { randomUUID } from "node:crypto";
import { beans, brewers, brewLogs, parameterSuggestions, recipes, users, workspaces } from "@barista/shared/schema";
import { buildBrewProfile, profileLines, type ProfileBrew, type ProfileFocus } from "@barista/shared/brewProfile";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db.js";
import { loadBrewProfile } from "../src/brewProfile.js";
import { loadBrewContext } from "../src/context.js";
import { loadSuggestContext } from "../src/suggestContext.js";

// The brew profile (docs/api/llm-contract.md §9, "Brew profile").
const focus: ProfileFocus = { methodKind: "filter", brewerId: "v60", brewer: "V60", recipeId: "house", recipe: "House", roastLevel: "light" };
let day = 30;
const b = (over: Partial<ProfileBrew> = {}): ProfileBrew => ({
  timestamp: `2026-10-${String(day--).padStart(2, "0")}T08:00:00.000Z`, // newest first
  rating: 4,
  methodKind: "filter",
  brewerId: "v60",
  recipeId: "house",
  roastLevel: "light",
  sameCoffee: true,
  roastAgeDays: null,
  tdsPercent: null,
  extractionYieldPercent: null,
  tempC: null,
  doseGrams: 15,
  timeSec: null,
  routeLabel: null,
  ...over,
});

describe("buildBrewProfile", () => {
  beforeEach(() => {
    day = 30;
  });

  it("needs 4 rated brews, and leaves out what too few brews tell", () => {
    expect(buildBrewProfile([b(), b(), b()], focus)).toBeNull();
    expect(buildBrewProfile([b(), b(), b({ rating: 3 }), b({ rating: 3 })], focus)).toEqual({
      brews: 4, rating: 3.5, best: null, temp: null, time: null, roastAge: null, routes: null,
    });
  });

  it("takes the TDS and EY range of this method's brews rated 4.5+, the middle 80% of many", () => {
    const best = [1.2, 1.3, 1.32, 1.35, 1.36, 1.38, 1.4, 1.45, 1.5, 1.6].map((t, i) => b({ rating: 5, tdsPercent: t, extractionYieldPercent: 18 + i / 2 }));
    const p = buildBrewProfile([...best, b({ rating: 3, tdsPercent: 1.0 }), b({ rating: 5, methodKind: "espresso", tdsPercent: 9 })], focus)!;
    expect(p.best).toEqual({ methodKind: "filter", brews: 10, tdsPercent: [1.3, 1.5], extractionYieldPercent: [18.5, 22] });
    // Fewer than 8: all of them; no EY recorded: TDS alone.
    expect(buildBrewProfile([1.3, 1.4, 1.35, 1.2].map((t) => b({ rating: 4.5, tdsPercent: t })), focus)!.best).toEqual({ methodKind: "filter", brews: 4, tdsPercent: [1.2, 1.4], extractionYieldPercent: null });
  });

  it("rates temperatures on this brewer for the roast level, or any roast when that's too few", () => {
    const level = [b({ tempC: 92, rating: 3 }), b({ tempC: 92.4, rating: 4 }), b({ tempC: 95, rating: 5 }), b({ tempC: 95, rating: 4 }), b({ brewerId: "chemex", tempC: 80 })];
    expect(buildBrewProfile(level, focus)!.temp).toEqual({ brewer: "V60", roastLevel: "light", byTempC: [{ at: 92, brews: 2, rating: 3.5 }, { at: 95, brews: 2, rating: 4.5 }] });
    const mixed = [b({ tempC: 92 }), b({ tempC: 92 }), b({ tempC: 93 }), b({ tempC: 90, roastLevel: "dark" }), b({ tempC: 90, roastLevel: "dark" })];
    // A temperature with one brew is left out (93 °C), so light alone is one bucket: too few.
    expect(buildBrewProfile(mixed, focus)!.temp).toEqual({ brewer: "V60", roastLevel: null, byTempC: [{ at: 90, brews: 2, rating: 4 }, { at: 92, brews: 2, rating: 4 }] });
    // One temperature only says nothing about temperature.
    expect(buildBrewProfile([b({ tempC: 93 }), b({ tempC: 93 }), b({ tempC: 93 }), b({ tempC: 93 })], focus)!.temp).toBeNull();
  });

  it("gives this recipe's median time per dose, and rating by roast-age week for this coffee", () => {
    const p = buildBrewProfile(
      [
        b({ timeSec: 180, roastAgeDays: 6 }),
        b({ timeSec: 200, roastAgeDays: 8, rating: 5 }),
        b({ timeSec: 190, roastAgeDays: 13, rating: 4.5 }),
        b({ timeSec: 240, doseGrams: 20.2, roastAgeDays: 3, rating: 3 }),
        b({ timeSec: 100, recipeId: "other", roastAgeDays: 30, sameCoffee: false }),
      ],
      focus,
    )!;
    expect(p.time).toEqual({ recipe: "House", byDose: [{ doseGrams: 15, brews: 3, medianSec: 190 }, { doseGrams: 20, brews: 1, medianSec: 240 }] });
    expect(p.roastAge).toEqual({ byWeek: [{ at: 0, brews: 2, rating: 3.5 }, { at: 7, brews: 2, rating: 4.8 }] });
  });

  it("tells how brews from suggested routes went against the others since the first", () => {
    const p = buildBrewProfile([b({ routeLabel: "More water", rating: 5 }), b({ rating: 3 }), b({ routeLabel: "Finer", rating: 4 }), b({ rating: 1 })], focus)!;
    expect(p.routes).toEqual({ brews: 2, rating: 4.5, otherRating: 3, recent: [{ label: "More water", rating: 5 }, { label: "Finer", rating: 4 }] });
  });

  it("writes it as a few lines", () => {
    const p = buildBrewProfile(
      [
        b({ rating: 5, tdsPercent: 1.3, extractionYieldPercent: 20, tempC: 94, timeSec: 185, routeLabel: "More water" }),
        b({ rating: 4.5, tdsPercent: 1.4, extractionYieldPercent: 21, tempC: 94, timeSec: 190 }),
        b({ rating: 4.5, tdsPercent: 1.35, extractionYieldPercent: 20.5, tempC: 92, timeSec: 200 }),
        b({ rating: 3, tempC: 92, timeSec: 240 }),
      ],
      { ...focus, roastLevel: null },
    )!;
    expect(profileLines(p)).toEqual([
      "Rated brews by this barista: 4, mean rating 4.3.",
      "Their filter brews rated 4.5+ (n=3): TDS 1.3-1.4%, EY 20-21%.",
      "Rating by kettle temperature on V60: 92 °C 3.8 (n=2); 94 °C 4.8 (n=2).",
      "Usual total time on House, by dose: 15 g 3:15 (n=4).",
      'Brews made from earlier suggested routes: n=1, mean rating 5. Latest: "More water" 5.',
    ]);
  });
});

describe("loadBrewProfile", () => {
  let workspaceId: string;
  let userId: string;
  let otherId: string;
  const id = { guji: "", kenya: "", v60: "", house: "", suggestion: "" };
  const logs: string[] = [];

  beforeEach(async () => {
    workspaceId = randomUUID();
    userId = randomUUID();
    otherId = randomUUID();
    for (const k of Object.keys(id) as Array<keyof typeof id>) id[k] = randomUUID();
    logs.length = 0;
    await db.insert(users).values([
      { id: userId, email: `p-${userId}@example.com`, passwordHash: "x" },
      { id: otherId, email: `o-${otherId}@example.com`, passwordHash: "x" },
    ]);
    await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: `w-${workspaceId}` });
    await db.insert(brewers).values({ id: id.v60, workspaceId, name: "V60" });
    await db.insert(beans).values([
      { id: id.guji, workspaceId, roasterName: "Onyx", beanName: "Guji", roastLevel: "light", roastDate: new Date("2026-10-01T00:00:00Z") },
      { id: id.kenya, workspaceId, roasterName: "Sey", beanName: "Kenya", roastLevel: "dark", roastDate: new Date("2026-10-01T00:00:00Z") },
    ]);
    await db.insert(recipes).values({ id: id.house, workspaceId, name: "House V60", brewerId: id.v60, targetDoseGrams: 15, targetWaterGrams: 250 });
    await db.insert(parameterSuggestions).values({
      id: id.suggestion, beanId: id.guji, recipeId: id.house, brewerId: id.v60, source: "recipe", maxBrews: 5, requestedBy: userId, status: "done",
      routes: [{ label: "More water", why: "Strong.", findings: [], grindSetting: null, grindRpm: null, tempC: null, ratio: 17 }],
    });
    // Days 2-7 by this barista; one unrated, one by someone else.
    const rows: Array<[number, string, string, number | null, number]> = [
      [2, id.guji, userId, 3, 92],
      [3, id.guji, userId, 4, 92],
      [4, id.kenya, userId, 5, 94],
      [5, id.guji, userId, 4.5, 94],
      [6, id.guji, userId, null, 94],
      [7, id.guji, otherId, 1, 90],
      [9, id.guji, userId, 4, 94],
    ];
    for (const [d, beanId, by, rating, tempC] of rows) {
      const logId = randomUUID();
      logs.push(logId);
      await db.insert(brewLogs).values({
        id: logId, workspaceId, userId: by, beanId, recipeId: id.house, brewerId: id.v60, rating, actualTempC: tempC,
        timestamp: new Date(`2026-10-0${d}T08:00:00Z`), actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 180,
        ...(d === 5 ? { suggestionId: id.suggestion, suggestionRoute: 0 } : {}),
      });
    }
  });

  const request = (over = {}) => ({
    personId: userId, workspaceId, beanId: id.guji, focus: { methodKind: "filter", brewerId: id.v60, brewer: "V60", recipeId: id.house, recipe: "House V60", roastLevel: "light" }, ...over,
  });

  it("works from this barista's rated brews only, with the route each came from", async () => {
    const p = (await loadBrewProfile(request(), new Set()))!;
    expect(p.brews).toBe(5);
    expect(p.routes).toEqual({ brews: 1, rating: 4.5, otherRating: 4, recent: [{ label: "More water", rating: 4.5 }] });
    expect(p.time).toEqual({ recipe: "House V60", byDose: [{ doseGrams: 15, brews: 5, medianSec: 180 }] });
    // Roast age: the Guji brews only (days 1, 2, 4 and 8 off roast); the
    // second week has one brew, so there's nothing to compare.
    expect(p.roastAge).toBeNull();
  });

  it("stops before a date and skips the brew analyzed; nothing when hidden or nobody", async () => {
    expect((await loadBrewProfile(request({ before: new Date("2026-10-09T00:00:00Z"), exceptBrewId: logs[0] }), new Set()))).toBeNull(); // 3 left
    expect((await loadBrewProfile(request({ before: new Date("2026-10-09T00:00:00Z") }), new Set()))!.brews).toBe(4);
    expect(await loadBrewProfile(request(), new Set(["brewProfile"]))).toBeNull();
    expect(await loadBrewProfile(request({ personId: null }), new Set())).toBeNull();
  });

  it("groups temperatures by roast level only when the AI may see it", async () => {
    expect((await loadBrewProfile(request(), new Set()))!.temp).toMatchObject({ roastLevel: "light" });
    expect((await loadBrewProfile(request(), new Set(["roastLevel"])))!.temp).toEqual({
      brewer: "V60", roastLevel: null, byTempC: [{ at: 92, brews: 2, rating: 3.5 }, { at: 94, brews: 3, rating: 4.5 }],
    });
  });

  it("goes with an analysis (the barista's) and a suggestion (the asker's) only when asked for", async () => {
    const last = logs[logs.length - 1]!;
    expect((await loadBrewContext(last))!.profile).toBeNull();
    expect((await loadBrewContext(last, { profile: new Set() }))!.profile).toMatchObject({ brews: 4 }); // the ones before it
    const suggestion = {
      beanId: id.guji, recipeId: id.house, brewerId: id.v60, grinderId: null, requestedBy: userId, source: "recipe" as const, maxBrews: 5,
      batchDoseGrams: null, batchWaterGrams: null, batchIceGrams: null, batchYieldGrams: null, alternativesAsked: null,
    };
    expect((await loadSuggestContext(suggestion))!.profile).toBeNull();
    expect((await loadSuggestContext(suggestion, { profile: new Set() }))!.profile).toMatchObject({ brews: 5 });
    expect((await loadSuggestContext({ ...suggestion, requestedBy: otherId }, { profile: new Set() }))!.profile).toBeNull(); // one brew
  });
});
