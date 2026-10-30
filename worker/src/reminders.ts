import { and, eq } from "drizzle-orm";
import type { GreenLowJobData, RateReminderJobData, RestReminderJobData, SteepReminderJobData } from "@barista/shared/jobs";
import { sendNotification, type NotificationMessage } from "@barista/shared/notify";
import {
  beans,
  brewers,
  brewLogs,
  DEFAULT_PREFERENCES,
  drinks,
  greenCoffees,
  notificationChannels,
  roasts,
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

// The roast's ready moment, 8:00 local on its roast date + rest days. Twin of
// restReadyAt in backend/src/reminders.ts; keep both in sync.
function restReadyAt(r: { roastedAt: Date; utcOffsetMinutes: number | null; restDays: number }): Date {
  const offsetMs = (r.utcOffsetMinutes ?? 0) * 60_000;
  const day = new Date(r.roastedAt.getTime() + offsetMs);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + r.restDays, 8) - offsetMs);
}

// "21 Oct", the roast's local date.
function roastDayText(roastedAt: Date, utcOffsetMinutes: number | null): string {
  return new Date(roastedAt.getTime() + (utcOffsetMinutes ?? 0) * 60_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

// A home roast has rested: ready to brew. Skipped once deleted, or when an
// edit moved its ready day later (its new reminder is queued for then).
export async function processRestReminder({ roastId, userId }: RestReminderJobData, send: Send = sendNotification): Promise<ReminderResult> {
  const [roast] = await db
    .select({ roastedAt: roasts.roastedAt, utcOffsetMinutes: roasts.utcOffsetMinutes, restDays: roasts.restDays, batchNumber: roasts.batchNumber, greenName: greenCoffees.name })
    .from(roasts)
    .leftJoin(greenCoffees, eq(roasts.greenCoffeeId, greenCoffees.id))
    .where(eq(roasts.id, roastId));
  if (!roast) return { status: "skipped", reason: "roast deleted" };
  if (restReadyAt(roast).getTime() > Date.now() + 60_000) return { status: "skipped", reason: "not ready yet" };
  const prefs = await preferencesOf(userId);
  if (!prefs) return { status: "skipped", reason: "user deleted" };
  if (!prefs.restReminders) return { status: "skipped", reason: "rest reminders off" };
  const batch = roast.batchNumber ? ` · batch ${roast.batchNumber}` : "";
  return deliver(
    userId,
    {
      title: "Your roast is ready to brew",
      message: `${roast.greenName ?? "Your roast"}${batch} · roasted ${roastDayText(roast.roastedAt, roast.utcOffsetMinutes)}`,
      url: config.appUrl ? `${config.appUrl}/roast/roasts/${roastId}` : null,
    },
    send
  );
}

// A roast took a green coffee below its low-stock threshold. Skipped if it's
// been restocked (or deleted) since.
export async function processGreenLow({ greenCoffeeId, userId }: GreenLowJobData, send: Send = sendNotification): Promise<ReminderResult> {
  const [green] = await db
    .select({ name: greenCoffees.name, weightLeftGrams: greenCoffees.weightLeftGrams, lowStockGrams: greenCoffees.lowStockGrams })
    .from(greenCoffees)
    .where(eq(greenCoffees.id, greenCoffeeId));
  if (!green) return { status: "skipped", reason: "green coffee deleted" };
  if (green.lowStockGrams === null || green.weightLeftGrams >= green.lowStockGrams) return { status: "skipped", reason: "not low any more" };
  const prefs = await preferencesOf(userId);
  if (!prefs) return { status: "skipped", reason: "user deleted" };
  if (!prefs.greenStockAlerts) return { status: "skipped", reason: "stock alerts off" };
  return deliver(
    userId,
    {
      title: green.weightLeftGrams > 0 ? "Green coffee running low" : "Green coffee used up",
      message: green.weightLeftGrams > 0 ? `${green.name} · ${green.weightLeftGrams} g left` : `${green.name} · none left`,
      url: config.appUrl ? `${config.appUrl}/roast/green` : null,
    },
    send
  );
}
