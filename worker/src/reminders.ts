import { and, eq } from "drizzle-orm";
import type { RateReminderJobData, SteepReminderJobData } from "@barista/shared/jobs";
import { sendNotification, type NotificationMessage } from "@barista/shared/notify";
import {
  beans,
  brewers,
  brewLogs,
  DEFAULT_PREFERENCES,
  drinks,
  notificationChannels,
  users,
  withDefaults,
  type NotificationConfigs,
  type NotificationKind,
} from "@barista/shared/schema";
import { config } from "./config.js";
import { db } from "./db.js";

// Rate-later reminders (docs/api/notifications.md §1b): when the delay is
// up, remind the person through each of their enabled channels, unless the
// brew has been rated (or deleted) or they turned reminders off since.

export type ReminderResult = { status: "sent"; channels: number; failed: string[] } | { status: "skipped"; reason: string };
type Send = typeof sendNotification;

// "8:42" in the brew's own time zone (its device's offset, else BREW_TIMEZONE).
function brewTime(timestamp: Date, utcOffsetMinutes: number | null): string {
  if (utcOffsetMinutes !== null) return new Date(timestamp.getTime() + utcOffsetMinutes * 60_000).toISOString().slice(11, 16).replace(/^0/, "");
  return timestamp.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: config.brewTimezone ?? "UTC" }).replace(/^0/, "");
}

// The brew a reminder is about, with what's needed for its message.
async function loadBrew(brewLogId: string) {
  const [brew] = await db
    .select({
      rating: brewLogs.rating,
      drinkRating: brewLogs.drinkRating,
      steeping: brewLogs.steeping,
      timestamp: brewLogs.timestamp,
      utcOffsetMinutes: brewLogs.utcOffsetMinutes,
      beanName: beans.beanName,
      roasterName: beans.roasterName,
      brewerName: brewers.name,
      drinkName: drinks.name,
    })
    .from(brewLogs)
    .innerJoin(beans, eq(brewLogs.beanId, beans.id))
    .leftJoin(brewers, eq(brewLogs.brewerId, brewers.id))
    .leftJoin(drinks, eq(brewLogs.drinkId, drinks.id))
    .where(eq(brewLogs.id, brewLogId));
  return brew ?? null;
}

async function preferencesOf(userId: string) {
  const [user] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId));
  return user ? withDefaults(DEFAULT_PREFERENCES, user.preferences ?? null) : null;
}

// Sends to each enabled channel; one failing doesn't stop the others, and
// every one failing throws, so BullMQ retries.
async function deliver(userId: string, message: NotificationMessage, send: Send): Promise<ReminderResult> {
  const channels = await db
    .select({ kind: notificationChannels.kind, config: notificationChannels.config })
    .from(notificationChannels)
    .where(and(eq(notificationChannels.userId, userId), eq(notificationChannels.enabled, true)));
  if (channels.length === 0) return { status: "skipped", reason: "no enabled channel" };
  const results = await Promise.allSettled(
    channels.map((c) => send(c.kind, c.config as NotificationConfigs[NotificationKind], message))
  );
  const failed = results.flatMap((r, i) => (r.status === "rejected" ? [`${channels[i]?.kind}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : []));
  if (failed.length === channels.length) throw new Error(`Every channel failed (${failed.join("; ")})`);
  return { status: "sent", channels: channels.length - failed.length, failed };
}

const entryUrl = (brewLogId: string) => (config.appUrl ? `${config.appUrl}/journal/${brewLogId}` : null);

export async function processRateReminder({ brewLogId, userId }: RateReminderJobData, send: Send = sendNotification): Promise<ReminderResult> {
  const brew = await loadBrew(brewLogId);
  if (!brew) return { status: "skipped", reason: "brew deleted" };
  if (brew.rating !== null || brew.drinkRating !== null) return { status: "skipped", reason: "already rated" };
  const prefs = await preferencesOf(userId);
  if (!prefs) return { status: "skipped", reason: "user deleted" };
  if (!prefs.rateReminders) return { status: "skipped", reason: "reminders off" };
  const made = brew.drinkName ?? brew.brewerName ?? "Your brew";
  return deliver(
    userId,
    {
      title: "How was it? Rate your brew",
      message: `${made} · ${brew.roasterName} ${brew.beanName} · ${brewTime(brew.timestamp, brew.utcOffsetMinutes)}`,
      url: entryUrl(brewLogId),
    },
    send
  );
}

// A cold brew's steep window has opened: time to filter it (and then finish
// it in the journal). Skipped once it's finished or deleted.
export async function processSteepReminder({ brewLogId, userId }: SteepReminderJobData, send: Send = sendNotification): Promise<ReminderResult> {
  const brew = await loadBrew(brewLogId);
  if (!brew) return { status: "skipped", reason: "brew deleted" };
  if (!brew.steeping) return { status: "skipped", reason: "already finished" };
  const prefs = await preferencesOf(userId);
  if (!prefs) return { status: "skipped", reason: "user deleted" };
  if (!prefs.steepReminders) return { status: "skipped", reason: "steep reminders off" };
  const made = brew.drinkName ?? brew.brewerName ?? "Cold brew";
  return deliver(
    userId,
    {
      title: "Your cold brew is ready to filter",
      message: `${made} · ${brew.roasterName} ${brew.beanName} · started ${brewTime(brew.timestamp, brew.utcOffsetMinutes)}`,
      url: entryUrl(brewLogId),
    },
    send
  );
}
