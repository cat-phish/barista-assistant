import { randomUUID } from "node:crypto";
import { beans, DEFAULT_PREFERENCES, notificationChannels, users, workspaceMembers, workspaces, type UserPreferences } from "@barista/shared/schema";
import { NotificationError } from "@barista/shared/notify";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { db } from "../src/db.js";
import { processBeanRestTick, restMessage, restReminderDue } from "../src/beanRest.js";

// docs/api/notifications.md §1b "Resting beans": real database, fake sending.
const prefs = (p: Partial<UserPreferences> = {}) => ({ ...DEFAULT_PREFERENCES, ...p });

describe("restReminderDue", () => {
  const bean = { restingUntil: "2026-11-10", restLastRemindedOn: null };
  it("is due from 8:00 on the ready day, once without a repeat", () => {
    expect(restReminderDue(bean, prefs(), "2026-11-10", "08:00")).toBe(true);
    expect(restReminderDue(bean, prefs(), "2026-11-10", "07:45")).toBe(false);
    expect(restReminderDue(bean, prefs(), "2026-11-09", "12:00")).toBe(false);
    expect(restReminderDue(bean, prefs(), "2026-11-14", "08:00")).toBe(true); // catching up later
    expect(restReminderDue({ ...bean, restLastRemindedOn: "2026-11-10" }, prefs(), "2026-11-20", "09:00")).toBe(false);
    expect(restReminderDue(bean, prefs({ restReminders: false }), "2026-11-10", "08:00")).toBe(false);
  });

  it("repeats every restReminderRepeatDays after the last one", () => {
    const reminded = { ...bean, restLastRemindedOn: "2026-11-10" };
    const every3 = prefs({ restReminderRepeatDays: 3 });
    expect(restReminderDue(reminded, every3, "2026-11-12", "08:00")).toBe(false);
    expect(restReminderDue(reminded, every3, "2026-11-13", "07:59")).toBe(false);
    expect(restReminderDue(reminded, every3, "2026-11-13", "08:00")).toBe(true);
  });
});

describe("restMessage", () => {
  it("names one bean in full, or lists several", () => {
    expect(restMessage([{ roasterName: "Onyx", beanName: "Geometry", batchNumber: null }])).toBe("Onyx · Geometry");
    expect(restMessage([{ roasterName: "Home roast", beanName: "Guji", batchNumber: "3" }])).toBe("Home roast · Guji · batch 3");
    expect(restMessage([{ roasterName: "Onyx", beanName: "Geometry", batchNumber: null }, { roasterName: "Home roast", beanName: "Guji", batchNumber: "3" }])).toBe("2 beans: Geometry, Guji (batch 3)");
  });
});

describe("processBeanRestTick", () => {
  // Tuesday 10 Nov 2026, 08:15 in London (GMT).
  const now = new Date("2026-11-10T08:15:00Z");

  async function setup(p: Partial<UserPreferences> = {}) {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, passwordHash: "x", preferences: { timeZone: "Europe/London", ...p } });
    await db.insert(workspaces).values({ id: workspaceId, name: "W", slug: `w-${workspaceId.slice(0, 8)}` });
    await db.insert(workspaceMembers).values({ userId, workspaceId, role: "owner" });
    await db.insert(notificationChannels).values({ id: randomUUID(), userId, kind: "ntfy", config: { server: "https://ntfy.sh", topic: "t", token: null } });
    const bean = async (fields: Partial<typeof beans.$inferInsert> = {}) => {
      const id = randomUUID();
      await db.insert(beans).values({ id, workspaceId, roasterName: "Onyx", beanName: "Geometry", restingUntil: "2026-11-10", restingBy: userId, ...fields });
      return id;
    };
    const remindedOn = async (id: string) => (await db.select({ d: beans.restLastRemindedOn }).from(beans).where(eq(beans.id, id)))[0]?.d;
    return { userId, workspaceId, bean, remindedOn };
  }

  it("sends one notification per person and workspace, and marks the beans", async () => {
    const { bean, remindedOn } = await setup();
    const a = await bean();
    const b = await bean({ beanName: "Guji", roasterName: "Home roast", batchNumber: "3", restingUntil: "2026-11-01" });
    const later = await bean({ beanName: "Later", restingUntil: "2026-11-11" });
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processBeanRestTick(now, send)).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![2]).toEqual({
      title: "2 beans are ready to brew",
      message: "2 beans: Geometry, Guji (batch 3)",
      url: config.appUrl ? `${config.appUrl}/beans/resting` : null,
    });
    expect([await remindedOn(a), await remindedOn(b), await remindedOn(later)]).toEqual(["2026-11-10", "2026-11-10", null]);
    // Not again the same day, nor later without a repeat: only the one not ready before.
    expect(await processBeanRestTick(now, send)).toEqual({ sent: 0, failed: 0 });
    const next = vi.fn().mockResolvedValue(undefined);
    expect(await processBeanRestTick(new Date("2026-11-20T09:00:00Z"), next)).toEqual({ sent: 1, failed: 0 });
    expect(next.mock.calls[0]![2]).toMatchObject({ message: "Onyx · Later" });
  });

  it("repeats every N days per the person's preference, in their zone", async () => {
    const { bean, remindedOn } = await setup({ restReminderRepeatDays: 2, timeZone: "America/Los_Angeles" });
    const id = await bean({ restLastRemindedOn: "2026-11-08" });
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processBeanRestTick(now, send)).toEqual({ sent: 0, failed: 0 }); // 00:15 on the 10th there
    expect(await processBeanRestTick(new Date("2026-11-10T16:00:00Z"), send)).toEqual({ sent: 1, failed: 0 }); // 08:00 there
    expect(await remindedOn(id)).toBe("2026-11-10");
    expect(send.mock.calls[0]![2]).toMatchObject({ title: "Your beans are ready to brew", message: "Onyx · Geometry" });
  });

  it("skips archived, active and unowned beans, non-members, reminders off, and no channel", async () => {
    const { userId, workspaceId, bean, remindedOn } = await setup();
    await bean({ archivedAt: new Date() });
    await bean({ restingUntil: null });
    await bean({ restingBy: null });
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await processBeanRestTick(now, send)).toEqual({ sent: 0, failed: 0 });

    const id = await bean();
    await db.update(users).set({ preferences: { timeZone: "Europe/London", restReminders: false } }).where(eq(users.id, userId));
    expect(await processBeanRestTick(now, send)).toEqual({ sent: 0, failed: 0 });
    await db.update(users).set({ preferences: { timeZone: "Europe/London" } }).where(eq(users.id, userId));
    await db.delete(notificationChannels).where(eq(notificationChannels.userId, userId));
    expect(await processBeanRestTick(now, send)).toEqual({ sent: 0, failed: 0 });
    expect(await remindedOn(id)).toBeNull(); // so adding a channel still reminds
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    expect(await processBeanRestTick(now, send)).toEqual({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves a bean unmarked when every channel fails, so the next tick tries again", async () => {
    const { bean, remindedOn } = await setup();
    const id = await bean();
    const send = vi.fn().mockRejectedValue(new NotificationError("down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await processBeanRestTick(now, send)).toEqual({ sent: 0, failed: 1 });
    expect(await remindedOn(id)).toBeNull();
  });
});
