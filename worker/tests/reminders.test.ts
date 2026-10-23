import { randomUUID } from "node:crypto";
import { beans, brewers, brewLogs, notificationChannels, users, workspaces } from "@barista/shared/schema";
import { NotificationError } from "@barista/shared/notify";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { db } from "../src/db.js";
import { processRateReminder, processSteepReminder } from "../src/reminders.js";

// docs/api/notifications.md §1b: real database, fake sending.
let userId: string;
let brewLogId: string;

beforeEach(async () => {
  userId = randomUUID();
  brewLogId = randomUUID();
  const workspaceId = randomUUID();
  const beanId = randomUUID();
  const brewerId = randomUUID();
  await db.insert(users).values({ id: userId, email: "r@example.com", passwordHash: "x" });
  await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: "w" });
  await db.insert(brewers).values({ id: brewerId, workspaceId, name: "V60" });
  await db.insert(beans).values({ id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji" });
  await db.insert(brewLogs).values({
    id: brewLogId, workspaceId, userId, beanId, brewerId, timestamp: new Date("2026-10-23T15:42:00Z"), utcOffsetMinutes: -420,
    actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150,
  });
  await db.insert(notificationChannels).values([
    { id: randomUUID(), userId, kind: "ntfy", config: { server: "https://ntfy.sh", topic: "t", token: null } },
    { id: randomUUID(), userId, kind: "discord", config: { url: "https://discord.example/hook" } },
    { id: randomUUID(), userId, kind: "slack", enabled: false, config: { url: "https://slack.example/hook" } },
  ]);
});

describe("processRateReminder", () => {
  it("reminds through each enabled channel, with what was brewed and when", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processRateReminder({ brewLogId, userId }, send)).toEqual({ status: "sent", channels: 2, failed: [] });
    expect(send.mock.calls.map((c) => c[0]).sort()).toEqual(["discord", "ntfy"]); // not the switched-off one
    expect(send.mock.calls[0]![2]).toEqual({
      title: "How was it? Rate your brew",
      message: "V60 · Onyx Guji · 8:42", // the device's local time (UTC-7)
      url: config.appUrl ? `${config.appUrl}/journal/${brewLogId}` : null,
    });
  });

  it("skips a brew rated (or deleted) in the meantime, or when reminders are off", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await db.update(brewLogs).set({ drinkRating: 4 }).where(eq(brewLogs.id, brewLogId));
    expect(await processRateReminder({ brewLogId, userId }, send)).toEqual({ status: "skipped", reason: "already rated" });
    await db.update(brewLogs).set({ drinkRating: null }).where(eq(brewLogs.id, brewLogId));
    await db.update(users).set({ preferences: { rateReminders: false } }).where(eq(users.id, userId));
    expect(await processRateReminder({ brewLogId, userId }, send)).toEqual({ status: "skipped", reason: "reminders off" });
    expect(await processRateReminder({ brewLogId: randomUUID(), userId }, send)).toEqual({ status: "skipped", reason: "brew deleted" });
    expect(send).not.toHaveBeenCalled();
  });

  it("one channel failing doesn't stop the others; all failing is retried", async () => {
    const send = vi.fn(async (kind: string) => {
      if (kind === "ntfy") throw new NotificationError("answered 500");
    });
    expect(await processRateReminder({ brewLogId, userId }, send)).toEqual({ status: "sent", channels: 1, failed: ["ntfy: answered 500"] });
    const none = vi.fn().mockRejectedValue(new NotificationError("answered 503"));
    await expect(processRateReminder({ brewLogId, userId }, none)).rejects.toThrow(/Every channel failed/);
  });
});

describe("processSteepReminder", () => {
  it("says a steeping cold brew is ready; skips one already finished, or with steep reminders off", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processSteepReminder({ brewLogId, userId }, send)).toEqual({ status: "skipped", reason: "already finished" });
    await db.update(brewLogs).set({ steeping: true }).where(eq(brewLogs.id, brewLogId));
    expect(await processSteepReminder({ brewLogId, userId }, send)).toMatchObject({ status: "sent", channels: 2 });
    expect(send.mock.calls[0]![2]).toMatchObject({ title: "Your cold brew is ready to filter", message: "V60 · Onyx Guji · started 8:42" });
    await db.update(users).set({ preferences: { steepReminders: false } }).where(eq(users.id, userId));
    expect(await processSteepReminder({ brewLogId, userId }, send)).toEqual({ status: "skipped", reason: "steep reminders off" });
  });
});

