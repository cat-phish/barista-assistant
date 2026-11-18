import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beans, brewLogs, recaps, users, workspaceMembers, workspaces } from "@barista/shared/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db.js";
import { processYearFreeze } from "../src/yearFreeze.js";

// Your Year in Coffee frozen on 7 December (docs/api/recaps.md §11c): real database.
describe("freezing Your Year in Coffee", () => {
  let ws: string;
  let bean: string;
  const person = async (zone: string) => {
    const id = randomUUID();
    await db.insert(users).values({ id, email: `${id}@example.com`, passwordHash: "x", preferences: { timeZone: zone } });
    await db.insert(workspaceMembers).values({ userId: id, workspaceId: ws, role: "barista" });
    return id;
  };
  const brew = (userId: string, timestamp: string) =>
    db.insert(brewLogs).values({ id: randomUUID(), workspaceId: ws, userId, beanId: bean, timestamp: new Date(timestamp), utcOffsetMinutes: 0, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150 });
  const frozen = async (userId: string) =>
    (await db.select({ scope: recaps.scope, figures: recaps.figures }).from(recaps).where(and(eq(recaps.userId, userId), eq(recaps.kind, "yearInCoffee"), eq(recaps.periodStart, "2026-01-01"))))
      .map((r) => [r.scope, r.figures?.figures.recap.brews])
      .sort();

  beforeEach(async () => {
    ws = randomUUID();
    bean = randomUUID();
    await db.insert(workspaces).values({ id: ws, name: "Bar", slug: `bar-${ws.slice(0, 8)}` });
    await db.insert(beans).values({ id: bean, workspaceId: ws, roasterName: "Onyx", beanName: "Guji" });
  });

  it("freezes each person's own year and the bar's once their day reaches 7 December", async () => {
    const london = await person("Europe/London");
    const auckland = await person("Pacific/Auckland");
    const quiet = await person("Europe/London"); // never brewed: only the bar's
    await brew(london, "2026-02-01T08:00:00Z");
    await brew(auckland, "2026-05-01T08:00:00Z");

    expect(await processYearFreeze(new Date("2026-11-30T12:00:00Z"))).toEqual({ frozen: 0, failed: 0 });
    // 6 December 12:00 UTC is already 7 December in Auckland, not in London.
    expect(await processYearFreeze(new Date("2026-12-06T12:00:00Z"))).toEqual({ frozen: 2, failed: 0 });
    expect(await frozen(auckland)).toEqual([["all", 2], ["mine", 1]]); // London's late brew isn't in yet
    expect(await frozen(london)).toEqual([]);

    await brew(london, "2026-12-06T20:00:00Z"); // still 6 December in London
    await brew(london, "2026-12-07T09:00:00Z"); // after the window: never counted
    expect(await processYearFreeze(new Date("2026-12-07T08:00:00Z"))).toEqual({ frozen: 3, failed: 0 });
    expect(await frozen(london)).toEqual([["all", 3], ["mine", 2]]);
    expect(await frozen(quiet)).toEqual([["all", 3]]);
    // Nothing left to do; Auckland's stays as it froze.
    expect(await processYearFreeze(new Date("2026-12-08T08:00:00Z"))).toEqual({ frozen: 0, failed: 0 });
    expect(await frozen(auckland)).toEqual([["all", 2], ["mine", 1]]);
  });
});
