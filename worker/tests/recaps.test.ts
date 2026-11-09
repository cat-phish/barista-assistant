import { randomUUID } from "node:crypto";
import { beans, brewers, brewLogs, notificationChannels, recaps, users, workspaceMembers, workspaces } from "@barista/shared/schema";
import { NotificationError } from "@barista/shared/notify";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { db } from "../src/db.js";
import { processRecapTick, recapMessage, recapsDueNow as dueIn, recapZone, zonedNow } from "../src/recaps.js";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@barista/shared/schema";

// docs/api/notifications.md §1b "Recaps": real database, fake sending.
const prefs = (p: Partial<UserPreferences> = {}): UserPreferences => ({ ...DEFAULT_PREFERENCES, timeZone: "Europe/London", ...p });
// Due in the person's zone (no workspace zone).
const recapsDueNow = (p: UserPreferences, now: Date) => dueIn(p, now, recapZone(p, null));

describe("recapsDueNow", () => {
  // Monday 9 Nov 2026, 08:00 in London (GMT) and 00:00 in Los Angeles.
  const mondayEight = new Date("2026-11-09T08:00:00Z");

  it("is due from the chosen time on the first day of a new week", () => {
    expect(recapsDueNow(prefs(), mondayEight)).toEqual([{ kind: "weekly", period: { start: "2026-11-02", end: "2026-11-08" } }]);
    expect(recapsDueNow(prefs(), new Date("2026-11-09T07:59:00Z"))).toEqual([]);
    expect(recapsDueNow(prefs(), new Date("2026-11-09T23:45:00Z"))).toHaveLength(1); // catching up the same day
    expect(recapsDueNow(prefs(), new Date("2026-11-10T08:00:00Z"))).toEqual([]); // not the day after
    expect(recapsDueNow(prefs({ recapNotifyTime: "09:30" }), mondayEight)).toEqual([]);
  });

  it("follows the person's time zone and week start", () => {
    expect(recapsDueNow(prefs({ timeZone: "America/Los_Angeles" }), mondayEight)).toEqual([]); // still Sunday there
    expect(recapsDueNow(prefs({ timeZone: "America/Los_Angeles" }), new Date("2026-11-09T16:00:00Z"))).toHaveLength(1);
    expect(recapsDueNow(prefs({ weekStartsOn: 0 }), mondayEight)).toEqual([]);
    expect(recapsDueNow(prefs({ weekStartsOn: 0 }), new Date("2026-11-08T08:00:00Z"))).toEqual([{ kind: "weekly", period: { start: "2026-11-01", end: "2026-11-07" } }]);
  });

  it("monthly on the 1st; nothing with recaps or notifications off", () => {
    const first = new Date("2026-12-01T08:00:00Z"); // a Tuesday
    expect(recapsDueNow(prefs(), first)).toEqual([{ kind: "monthly", period: { start: "2026-11-01", end: "2026-11-30" } }]);
    expect(recapsDueNow(prefs({ recapPeriods: "weekly" }), first)).toEqual([]);
    expect(recapsDueNow(prefs({ recaps: false }), mondayEight)).toEqual([]);
    expect(recapsDueNow(prefs({ recapNotify: false }), mondayEight)).toEqual([]);
  });

  it("uses the workspace's zone for someone without their own, then the server's", () => {
    expect(recapZone(prefs(), { timeZone: "Asia/Tokyo" })).toBe("Europe/London");
    expect(recapZone(prefs({ timeZone: null }), { timeZone: "Asia/Tokyo" })).toBe("Asia/Tokyo");
    expect(recapZone(prefs({ timeZone: null }), {})).toBe(config.brewTimezone ?? "UTC");
  });

  it("reads local time with hours past midnight as 00", () => {
    expect(zonedNow(new Date("2026-11-09T00:05:00Z"), "UTC")).toEqual({ day: "2026-11-09", time: "00:05" });
  });
});

describe("recapMessage", () => {
  it("counts, averages and names the newest best brew", () => {
    const week = { start: "2026-11-02", end: "2026-11-08" };
    expect(
      recapMessage("weekly", week, [
        { rating: 4.5, beanName: "Guji", brewerName: "V60" },
        { rating: 3, beanName: "Kenya", brewerName: null },
        { rating: null, beanName: "Kenya", brewerName: null },
        { rating: 4.5, beanName: "Kenya Nyeri", brewerName: "OXO" },
      ]),
    ).toBe("2–8 Nov · 4 brews · avg 4.0 · best 4.5, Kenya Nyeri on the OXO");
    expect(recapMessage("monthly", { start: "2026-10-01", end: "2026-10-31" }, [{ rating: null, beanName: "Guji", brewerName: null }])).toBe("October 2026 · 1 brew");
  });
});

describe("processRecapTick", () => {
  let userId: string;
  let workspaceId: string;
  let beanId: string;
  let brewerId: string;
  const monday = new Date("2026-11-09T08:00:00Z");
  const brew = (timestamp: string, rating: number | null, ws = workspaceId, offset: number | null = 0) =>
    db.insert(brewLogs).values({ id: randomUUID(), workspaceId: ws, userId, beanId, brewerId, timestamp: new Date(timestamp), utcOffsetMinutes: offset, actualDoseGrams: 15, actualWaterGrams: 250, actualTimeSec: 150, rating });

  beforeEach(async () => {
    userId = randomUUID();
    workspaceId = randomUUID();
    beanId = randomUUID();
    brewerId = randomUUID();
    await db.insert(users).values({ id: userId, email: "r@example.com", passwordHash: "x", preferences: { timeZone: "Europe/London" } });
    await db.insert(workspaces).values({ id: workspaceId, name: "Home", slug: "home" });
    await db.insert(workspaceMembers).values({ userId, workspaceId, role: "owner" });
    await db.insert(brewers).values({ id: brewerId, workspaceId, name: "V60" });
    await db.insert(beans).values({ id: beanId, workspaceId, roasterName: "Onyx", beanName: "Guji" });
    await db.insert(notificationChannels).values({ id: randomUUID(), userId, kind: "ntfy", config: { server: "https://ntfy.sh", topic: "t", token: null } });
  });

  it("sends last week's recap once, with a link to it", async () => {
    await brew("2026-11-03T08:00:00Z", 4);
    await brew("2026-11-07T08:00:00Z", 4.5);
    await brew("2026-11-09T07:00:00Z", 5); // this week
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processRecapTick(monday, send)).toEqual({ sent: 1, failed: 0 });
    expect(send.mock.calls[0]![2]).toEqual({
      title: "Your week in coffee",
      message: "2–8 Nov · 2 brews · avg 4.3 · best 4.5, Guji on the V60",
      url: config.appUrl ? `${config.appUrl}/insights/recap?kind=weekly&start=2026-11-02&ws=${workspaceId}` : null,
    });
    expect(await processRecapTick(new Date("2026-11-09T08:15:00Z"), send)).toEqual({ sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(recaps);
    expect(row).toMatchObject({ workspaceId, userId, kind: "weekly", periodStart: "2026-11-02", scope: "mine", status: "none" });
    expect(row!.notifiedAt).toBeInstanceOf(Date);
  });

  it("skips a week without brews, and workspaces the person has left", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processRecapTick(monday, send)).toEqual({ sent: 0, failed: 0 });
    const other = randomUUID();
    await db.insert(workspaces).values({ id: other, name: "Bar", slug: "bar" });
    await brew("2026-11-04T08:00:00Z", 3, other);
    expect(await processRecapTick(monday, send)).toEqual({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("counts a brew on its local day", async () => {
    await brew("2026-11-08T23:30:00Z", 4, workspaceId, 60); // Monday 00:30 where it was brewed
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processRecapTick(monday, send)).toEqual({ sent: 0, failed: 0 });
    await brew("2026-11-01T23:30:00Z", 4, workspaceId, 60); // Monday 2 Nov there
    expect(await processRecapTick(monday, send)).toEqual({ sent: 1, failed: 0 });
  });

  it("names the workspace when there's one per workspace", async () => {
    const other = randomUUID();
    await db.insert(workspaces).values({ id: other, name: "Bar", slug: "bar" });
    await db.insert(workspaceMembers).values({ userId, workspaceId: other, role: "barista" });
    await brew("2026-11-03T08:00:00Z", null);
    await brew("2026-11-04T08:00:00Z", null, other);
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processRecapTick(monday, send)).toEqual({ sent: 2, failed: 0 });
    expect(send.mock.calls.map((c) => (c[2] as { message: string }).message).sort()).toEqual(["Bar · 2–8 Nov · 1 brew", "Home · 2–8 Nov · 1 brew"]);
  });

  it("tries again at the next tick when sending failed or there was no channel", async () => {
    await brew("2026-11-03T08:00:00Z", 4);
    const failing = vi.fn().mockRejectedValue(new NotificationError("answered 503"));
    expect(await processRecapTick(monday, failing)).toEqual({ sent: 0, failed: 1 });
    await db.delete(notificationChannels).where(eq(notificationChannels.userId, userId));
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processRecapTick(monday, send)).toEqual({ sent: 0, failed: 0 });
    await db.insert(notificationChannels).values({ id: randomUUID(), userId, kind: "ntfy", config: { server: "https://ntfy.sh", topic: "t", token: null } });
    expect(await processRecapTick(monday, send)).toEqual({ sent: 1, failed: 0 });
  });

  it("follows the workspace's zone when the person has none", async () => {
    await brew("2026-11-03T08:00:00Z", 4);
    await db.update(users).set({ preferences: {} }).where(eq(users.id, userId));
    await db.update(workspaces).set({ settings: { timeZone: "America/Los_Angeles" } }).where(eq(workspaces.id, workspaceId));
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processRecapTick(monday, send)).toEqual({ sent: 0, failed: 0 }); // midnight there
    expect(await processRecapTick(new Date("2026-11-09T16:00:00Z"), send)).toEqual({ sent: 1, failed: 0 }); // 8:00 there
  });

  it("sends nothing with notifications off", async () => {
    await brew("2026-11-03T08:00:00Z", 4);
    await db.update(users).set({ preferences: { timeZone: "Europe/London", recapNotify: false } }).where(eq(users.id, userId));
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processRecapTick(monday, send)).toEqual({ sent: 0, failed: 0 });
  });
});
