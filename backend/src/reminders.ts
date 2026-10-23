import { and, eq } from "drizzle-orm";
import { DEFAULT_PREFERENCES, notificationChannels, users, withDefaults } from "@barista/shared/schema";
import { db } from "./db.js";
import { enqueueRateReminder } from "./queue.js";

// Rate later (docs/api/notifications.md §1b): the delay in minutes if the
// person has reminders on and at least one enabled channel, else null.
export async function reminderDelayMinutes(userId: string): Promise<number | null> {
  const [user] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
  if (!user) return null;
  const prefs = withDefaults(DEFAULT_PREFERENCES, user.preferences ?? null);
  if (!prefs.rateReminders) return null;
  const [channel] = await db
    .select({ id: notificationChannels.id })
    .from(notificationChannels)
    .where(and(eq(notificationChannels.userId, userId), eq(notificationChannels.enabled, true)))
    .limit(1);
  return channel ? prefs.rateReminderMinutes : null;
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
