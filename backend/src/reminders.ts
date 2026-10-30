import { and, eq } from "drizzle-orm";
import { DEFAULT_PREFERENCES, notificationChannels, users, withDefaults } from "@barista/shared/schema";
import { db } from "./db.js";
import { cancelRestReminder, enqueueGreenLow, enqueueRateReminder, enqueueRestReminder, enqueueSteepReminder } from "./queue.js";

// Rate later (docs/api/notifications.md §1b): the delay in minutes if the
// person has reminders on and at least one enabled channel, else null.
export async function reminderDelayMinutes(userId: string): Promise<number | null> {
  const [user] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
  if (!user) return null;
  const prefs = withDefaults(DEFAULT_PREFERENCES, user.preferences ?? null);
  if (!prefs.rateReminders) return null;
  return (await hasEnabledChannel(userId)) ? prefs.rateReminderMinutes : null;
}

async function preferencesOf(userId: string) {
  const [user] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
  return user ? withDefaults(DEFAULT_PREFERENCES, user.preferences ?? null) : null;
}

async function hasEnabledChannel(userId: string): Promise<boolean> {
  const [channel] = await db
    .select({ id: notificationChannels.id })
    .from(notificationChannels)
    .where(and(eq(notificationChannels.userId, userId), eq(notificationChannels.enabled, true)))
    .limit(1);
  return !!channel;
}

export type ReminderOutcome = "queued" | "off" | "unavailable";

// Never fails the save: Redis being down means no reminder, said in the reply.
export async function remindToRate(userId: string, brewLogId: string): Promise<ReminderOutcome> {
  const minutes = await reminderDelayMinutes(userId);
  if (minutes === null) return "off";
  try {
    await enqueueRateReminder({ brewLogId, userId }, minutes * 60_000);
    return "queued";
  } catch (err) {
    console.error(`Rate reminder for ${brewLogId} not queued:`, err instanceof Error ? err.message : err);
    return "unavailable";
  }
}

// A cold brew started with a steep window: remind when its shortest time is
// reached, counted from when it started (docs/api/notifications.md §1b). Off
// without a window, with steep reminders switched off, or with no enabled
// channel.
export async function remindWhenSteeped(userId: string, brewLogId: string, steepMinHours: number | null, startedAt: Date): Promise<ReminderOutcome | undefined> {
  if (steepMinHours === null) return undefined; // no window, nothing to remind about
  if (!(await preferencesOf(userId))?.steepReminders) return "off";
  if (!(await hasEnabledChannel(userId))) return "off";
  const delayMs = Math.max(0, startedAt.getTime() + steepMinHours * 3_600_000 - Date.now());
  try {
    await enqueueSteepReminder({ brewLogId, userId }, delayMs);
    return "queued";
  } catch (err) {
    console.error(`Steep reminder for ${brewLogId} not queued:`, err instanceof Error ? err.message : err);
    return "unavailable";
  }
}

const READY_HOUR = 8; // a rested roast's reminder goes out at 8:00 local time

type Resting = { roastedAt: Date; utcOffsetMinutes: number | null; restDays: number };

// The day a roast is ready (YYYY-MM-DD): its local roast date + its rest
// days, UTC when the offset is unknown, as its bean's roast date
// (docs/api/roasts.md §4f).
export function restReadyOn(r: Resting): string {
  const day = new Date(r.roastedAt.getTime() + (r.utcOffsetMinutes ?? 0) * 60_000);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + r.restDays)).toISOString().slice(0, 10);
}
// The reminder's moment: 8:00 local time that day.
export function restReadyAt(r: Resting): Date {
  return new Date(Date.parse(`${restReadyOn(r)}T00:00:00Z`) + READY_HOUR * 3_600_000 - (r.utcOffsetMinutes ?? 0) * 60_000);
}

// A roast that's still resting: remind its roaster the morning it's ready
// (docs/api/notifications.md §1b), replacing any reminder already waiting.
// Undefined when it's ready already (any waiting reminder is dropped); off
// with rest reminders switched off or no enabled channel.
export async function remindWhenRested(userId: string | null, roast: Resting & { id: string }): Promise<ReminderOutcome | undefined> {
  const delayMs = restReadyAt(roast).getTime() - Date.now();
  try {
    if (delayMs <= 0 || !userId) {
      await cancelRestReminder(roast.id);
      return undefined;
    }
    if (!(await preferencesOf(userId))?.restReminders || !(await hasEnabledChannel(userId))) {
      await cancelRestReminder(roast.id);
      return "off";
    }
    await enqueueRestReminder({ roastId: roast.id, userId }, delayMs);
    return "queued";
  } catch (err) {
    console.error(`Rest reminder for ${roast.id} not queued:`, err instanceof Error ? err.message : err);
    return "unavailable";
  }
}

// A roast took a green coffee below its low-stock threshold: tell whoever
// roasted it, right away. Never fails the save.
export async function alertGreenLow(userId: string, greenCoffeeId: string): Promise<void> {
  if (!(await preferencesOf(userId))?.greenStockAlerts || !(await hasEnabledChannel(userId))) return;
  try {
    await enqueueGreenLow({ greenCoffeeId, userId });
  } catch (err) {
    console.error(`Low-stock notice for ${greenCoffeeId} not queued:`, err instanceof Error ? err.message : err);
  }
}
