import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { sendNotification } from "@barista/shared/notify";
import { addDays } from "@barista/shared/recapPeriods";
import { beans, DEFAULT_PREFERENCES, users, withDefaults, workspaceMembers, workspaces, type UserPreferences } from "@barista/shared/schema";
import { sendWebPush } from "@barista/shared/webPush";
import { config } from "./config.js";
import { db } from "./db.js";
import { recapZone, zonedNow } from "./recaps.js";
import { deliver } from "./reminders.js";

// Resting beans (docs/api/notifications.md §1b, "Resting beans"). Every
// quarter hour the tick finds resting beans whose ready day has come, in the
// zone of whoever set them resting (theirs, else the workspace's, else
// BREW_TIMEZONE, else UTC), from 8:00. Each gets one reminder, then one every
// restReminderRepeatDays (that person's preference) until it's made active.
// One notification per person and workspace lists that morning's beans.

type Send = typeof sendNotification;
type Push = typeof sendWebPush;

export const READY_TIME = "08:00";

export interface BeanRestTickResult {
  sent: number;
  failed: number;
}

// Whether a bean is due a reminder on local day `day` at `time`.
export function restReminderDue(
  bean: { restingUntil: string; restLastRemindedOn: string | null },
  prefs: Pick<UserPreferences, "restReminders" | "restReminderRepeatDays">,
  day: string,
  time: string,
): boolean {
  if (!prefs.restReminders || time < READY_TIME || day < bean.restingUntil) return false;
  if (bean.restLastRemindedOn === null) return true;
  return prefs.restReminderRepeatDays !== null && day >= addDays(bean.restLastRemindedOn, prefs.restReminderRepeatDays);
}

// "Onyx · Southern Weather", or "3 beans: …" for several.
export function restMessage(list: Array<{ roasterName: string; beanName: string; batchNumber: string | null }>): string {
  const name = (b: (typeof list)[number]) => `${b.roasterName} · ${b.beanName}${b.batchNumber ? ` · batch ${b.batchNumber}` : ""}`;
  if (list.length === 1) return name(list[0]!);
  return `${list.length} beans: ${list.map((b) => `${b.beanName}${b.batchNumber ? ` (batch ${b.batchNumber})` : ""}`).join(", ")}`;
}

export async function processBeanRestTick(now: Date = new Date(), send: Send = sendNotification, push: Push = sendWebPush): Promise<BeanRestTickResult> {
  // Members only: someone who left the workspace isn't reminded about its beans.
  const rows = await db
    .select({
      id: beans.id,
      workspaceId: beans.workspaceId,
      roasterName: beans.roasterName,
      beanName: beans.beanName,
      batchNumber: beans.batchNumber,
      restingUntil: beans.restingUntil,
      restLastRemindedOn: beans.restLastRemindedOn,
      userId: users.id,
      preferences: users.preferences,
      settings: workspaces.settings,
    })
    .from(beans)
    .innerJoin(users, eq(users.id, beans.restingBy))
    .innerJoin(workspaces, eq(workspaces.id, beans.workspaceId))
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, beans.workspaceId), eq(workspaceMembers.userId, users.id)))
    .where(and(isNotNull(beans.restingUntil), isNull(beans.archivedAt)));

  const due = new Map<string, { userId: string; workspaceId: string; day: string; beans: typeof rows }>();
  for (const row of rows) {
    if (row.restingUntil === null) continue;
    const prefs = withDefaults(DEFAULT_PREFERENCES, row.preferences ?? null);
    const { day, time } = zonedNow(now, recapZone(prefs, row.settings));
    if (!restReminderDue({ restingUntil: row.restingUntil, restLastRemindedOn: row.restLastRemindedOn }, prefs, day, time)) continue;
    const key = `${row.userId}:${row.workspaceId}`;
    const group = due.get(key) ?? { userId: row.userId, workspaceId: row.workspaceId, day, beans: [] };
    group.beans.push(row);
    due.set(key, group);
  }

  let sent = 0;
  let failed = 0;
  for (const group of due.values()) {
    try {
      const result = await deliver(
        group.userId,
        {
          title: group.beans.length === 1 ? "Your beans are ready to brew" : `${group.beans.length} beans are ready to brew`,
          message: restMessage(group.beans),
          url: config.appUrl ? `${config.appUrl}/beans/resting` : null,
        },
        send,
        push,
      );
      // No channel: nothing's marked, so adding one later still reminds.
      if (result.status !== "sent") continue;
      for (const b of group.beans) await db.update(beans).set({ restLastRemindedOn: group.day }).where(eq(beans.id, b.id));
      sent++;
    } catch (err) {
      // Every channel failed: tried again next tick.
      console.error(`Resting beans reminder for ${group.userId} failed:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }
  return { sent, failed };
}
