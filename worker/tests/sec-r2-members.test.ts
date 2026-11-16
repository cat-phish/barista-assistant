// Security audit round 2, members: SEC-21 (reminders after removal),
// SEC-02/SEC-22 (a person's private AI prompt in the saved request).
import { randomUUID } from "node:crypto";
import { beans, brewLogs, greenCoffees, notificationChannels, users, workspaceMembers, workspaces } from "@barista/shared/schema";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db.js";
import { processAiPreview } from "../src/processor.js";
import { processGreenLow, processRateReminder, processSteepReminder } from "../src/reminders.js";

let userId: string;
let workspaceId: string;
let brewLogId: string;
let greenCoffeeId: string;

// A, a member of W, logged a brew (steeping, unrated) and owns a low green
// coffee there; then A's membership is removed.
beforeEach(async () => {
  userId = randomUUID();
  workspaceId = randomUUID();
  brewLogId = randomUUID();
  greenCoffeeId = randomUUID();
  const beanId = randomUUID();
  await db.insert(users).values({ id: userId, email: "a@example.com", passwordHash: "x", aiPrompt: { instructions: "SECRET-A", overrides: {} } });
  await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: "w" });
  await db.insert(workspaceMembers).values({ userId, workspaceId, role: "barista" });
  await db.insert(beans).values({ id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji" });
  await db.insert(brewLogs).values({ id: brewLogId, workspaceId, userId, beanId, timestamp: new Date("2026-10-23T15:42:00Z"), actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, steeping: true });
  await db.insert(greenCoffees).values({ id: greenCoffeeId, workspaceId, name: "Ethiopia Guji", weightLeftGrams: 80, lowStockGrams: 500 });
  await db.insert(notificationChannels).values({ id: randomUUID(), userId, kind: "ntfy", config: { server: "https://ntfy.sh", topic: "t", token: null } });
});

describe("SEC-21 reminders for a removed member", () => {
  const removed = () => db.delete(workspaceMembers).where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)));

  it("skips a rate reminder once the person is no longer a member", async () => {
    await removed();
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processRateReminder({ brewLogId, userId }, send)).toMatchObject({ status: "skipped" });
    expect(send).not.toHaveBeenCalled();
  });

  it("skips a steep reminder once the person is no longer a member", async () => {
    await removed();
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processSteepReminder({ brewLogId, userId }, send)).toMatchObject({ status: "skipped" });
    expect(send).not.toHaveBeenCalled();
  });

  it("skips a green-low alert once the person is no longer a member", async () => {
    await removed();
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processGreenLow({ greenCoffeeId, userId }, send)).toMatchObject({ status: "skipped" });
    expect(send).not.toHaveBeenCalled();
  });
});

// SEC-02 / SEC-22: the saved request (served to any member by GET .../request,
// docs/api/analysis.md §8c) carries the barista's private instructions verbatim.
describe("SEC-22 private AI prompt in the saved request", () => {
  // Parked for an owner decision (who may read a person's AI instructions).
  it.skip("keeps the barista's own instructions out of the request saved for every member", async () => {
    const request = await processAiPreview({ kind: "analysis", brewLogId });
    expect(request).not.toBeNull();
    expect(JSON.stringify(request)).not.toContain("SECRET-A");
  });
});
