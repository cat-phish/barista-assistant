import { and, eq } from "drizzle-orm";
import { DEFAULT_PREFERENCES, notificationChannels, recipes, users, withDefaults } from "@barista/shared/schema";
import { db } from "./db.js";
import { enqueueRateReminder, enqueueSteepReminder } from "./queue.js";

// Rate later (docs/api/notifications.md §1b): the delay in minutes if the
// person has reminders on and at least one enabled channel, else null.
export async function reminderDelayMinutes(userId: string): Promise<number | null> {
  const [user] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
  if (!user) return null;
  const prefs = withDefaults(DEFAULT_PREFERENCES, user.preferences ?? null);
  if (!prefs.rateReminders) return null;
  return (await hasEnabledChannel(userId)) ? prefs.rateReminderMinutes : null;
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
export async function remindWhenSteeped(userId: string, brewLogId: string, recipeId: string | null, startedAt: Date): Promise<ReminderOutcome | undefined> {
  if (!recipeId) return undefined;
  const [recipe] = await db.select({ steepMinHours: recipes.steepMinHours }).from(recipes).where(eq(recipes.id, recipeId));
  if (!recipe || recipe.steepMinHours === null) return undefined; // no window, nothing to remind about
  const [user] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
  if (!user || !withDefaults(DEFAULT_PREFERENCES, user.preferences ?? null).steepReminders) return "off";
  if (!(await hasEnabledChannel(userId))) return "off";
  const delayMs = Math.max(0, startedAt.getTime() + recipe.steepMinHours * 3_600_000 - Date.now());
  try {
    await enqueueSteepReminder({ brewLogId, userId }, delayMs);
    return "queued";
  } catch (err) {
    console.error(`Steep reminder for ${brewLogId} not queued:`, err instanceof Error ? err.message : err);
    return "unavailable";
  }
}
