import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { NotificationError, sendNotification } from "@barista/shared/notify";
import { endpointHash, PushGoneError, sendWebPush } from "@barista/shared/webPush";
import {
  NOTIFICATION_KINDS,
  notificationChannels,
  pushSubscriptions,
  SECRET_FIELDS,
  type NotificationConfig,
  type NotificationConfigs,
  type NotificationKind,
} from "@barista/shared/schema";
import { webPushSettings } from "../config.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";

// docs/api/notifications.md §1b: a person's own notification channels.
// Credentials come back masked; sending a masked value unchanged keeps the
// stored one, so the form can be saved without retyping them.

export interface ChannelSummary {
  kind: NotificationKind;
  enabled: boolean;
  config: Record<string, string | null>; // secrets masked
  createdAt: Date;
}

interface KindParams {
  kind: string;
}

// A Web Push device; the endpoint stays on the server.
export interface PushDeviceSummary {
  id: string;
  label: string;
  enabled: boolean;
  endpointHash: string;
  createdAt: Date;
}

interface IdParams {
  id: string;
}

const MASK = "••••";
export function mask(value: string): string {
  return value.length > 8 ? `${MASK}${value.slice(-4)}` : MASK;
}

const url = z.url({ protocol: /^https?$/ }).max(500);
const text = (max: number) => z.string().trim().min(1).max(max);
const configSchemas: { [K in NotificationKind]: z.ZodType<NotificationConfigs[K]> } = {
  ntfy: z.object({
    server: url.default("https://ntfy.sh"),
    topic: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "letters, numbers, - and _ only, up to 64"),
    token: z.string().trim().max(200).nullable().optional().transform((t) => t || null),
  }),
  gotify: z.object({ server: url, appToken: text(200) }),
  pushover: z.object({ userKey: text(100), appToken: text(100) }),
  discord: z.object({ url }),
  telegram: z.object({ botToken: text(200), chatId: text(100) }),
  slack: z.object({ url }),
  webhook: z.object({ url }),
};

const putBody = z.object({ enabled: z.boolean().default(true), config: z.record(z.string(), z.string().nullable()) }).strict();

const base64url = z.string().regex(/^[A-Za-z0-9_-]+=*$/, "base64url").max(200);
const subscribeBody = z
  .object({
    endpoint: z.url({ protocol: /^https$/ }).max(1000),
    keys: z.object({ p256dh: base64url, auth: base64url }),
    label: z.string().trim().min(1).max(60),
  })
  .strict();
const patchDeviceBody = z.object({ enabled: z.boolean() }).strict();

function summarizeDevice(row: typeof pushSubscriptions.$inferSelect): PushDeviceSummary {
  return { id: row.id, label: row.label, enabled: row.enabled, endpointHash: row.endpointHash, createdAt: row.createdAt };
}

const ownDevice = (userId: string, id: string) => and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id));

function isKind(kind: string): kind is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

function summarize(row: typeof notificationChannels.$inferSelect): ChannelSummary {
  const secrets = SECRET_FIELDS[row.kind] as readonly string[];
  const config: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(row.config as Record<string, string | null>)) {
    config[key] = value !== null && secrets.includes(key) ? mask(value) : value;
  }
  return { kind: row.kind, enabled: row.enabled, config, createdAt: row.createdAt };
}

// A masked secret sent back unchanged means "keep the stored one".
function unmask(kind: NotificationKind, incoming: Record<string, string | null>, stored: NotificationConfig | null): Record<string, string | null> {
  const out = { ...incoming };
  const old = (stored ?? {}) as Record<string, string | null>;
  for (const key of SECRET_FIELDS[kind] as readonly string[]) {
    const value = out[key];
    const kept = old[key];
    if (typeof value === "string" && value.startsWith(MASK) && typeof kept === "string" && value === mask(kept)) out[key] = kept;
  }
  return out;
}

const own = (userId: string, kind: NotificationKind) => and(eq(notificationChannels.userId, userId), eq(notificationChannels.kind, kind));

// Mounted at /api/auth/me/notifications
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req: Request, res: Response<{ channels: ChannelSummary[]; pushDevices: PushDeviceSummary[] }>) => {
  const userId = authedUserId(req);
  const rows = await db.select().from(notificationChannels).where(eq(notificationChannels.userId, userId));
  // In the services' fixed order (NOTIFICATION_KINDS), as the settings page lists them.
  rows.sort((a, b) => NOTIFICATION_KINDS.indexOf(a.kind) - NOTIFICATION_KINDS.indexOf(b.kind));
  const devices = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).orderBy(pushSubscriptions.createdAt, pushSubscriptions.id);
  res.json({ channels: rows.map(summarize), pushDevices: devices.map(summarizeDevice) });
});

// Web Push (docs/api/notifications.md §1b, "Web Push"): one entry per device.
// Declared before the /:kind routes.
const NOT_SET_UP = "Web Push isn't set up on this server";

notificationsRouter.get("/push/key", (_req: Request, res: Response<{ publicKey: string }>) => {
  const vapid = webPushSettings();
  if (!vapid) {
    sendError(res, 404, NOT_SET_UP);
    return;
  }
  res.json({ publicKey: vapid.publicKey });
});

// Saves this device's subscription. The same endpoint again (re-subscribed,
// or now signed in as someone else) updates that device instead.
notificationsRouter.post("/push", async (req: Request, res: Response<{ device: PushDeviceSummary }>) => {
  if (!webPushSettings()) {
    sendError(res, 404, NOT_SET_UP);
    return;
  }
  const body = parseBody(subscribeBody, req, res);
  if (!body) return;
  const userId = authedUserId(req);
  const hash = endpointHash(body.endpoint);
  const values = { userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, label: body.label, enabled: true };
  await db
    .insert(pushSubscriptions)
    .values({ id: randomUUID(), endpointHash: hash, ...values })
    .onDuplicateKeyUpdate({ set: values });
  const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpointHash, hash));
  if (!row) throw new Error("Push device missing after save");
  res.json({ device: summarizeDevice(row) });
});

notificationsRouter.patch("/push/:id", async (req: Request<IdParams>, res: Response<{ device: PushDeviceSummary }>) => {
  const body = parseBody(patchDeviceBody, req, res);
  if (!body) return;
  const userId = authedUserId(req);
  const [existing] = await db.select().from(pushSubscriptions).where(ownDevice(userId, req.params.id));
  if (!existing) {
    sendError(res, 404, "Not one of your devices");
    return;
  }
  await db.update(pushSubscriptions).set({ enabled: body.enabled }).where(eq(pushSubscriptions.id, existing.id));
  res.json({ device: summarizeDevice({ ...existing, enabled: body.enabled }) });
});

notificationsRouter.delete("/push/:id", async (req: Request<IdParams>, res: Response) => {
  const [result] = await db.delete(pushSubscriptions).where(ownDevice(authedUserId(req), req.params.id));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Not one of your devices");
    return;
  }
  res.status(204).end();
});

// A test to the device, enabled or not. A gone subscription removes it.
notificationsRouter.post("/push/:id/test", async (req: Request<IdParams>, res: Response) => {
  const vapid = webPushSettings();
  if (!vapid) {
    sendError(res, 404, NOT_SET_UP);
    return;
  }
  const [row] = await db.select().from(pushSubscriptions).where(ownDevice(authedUserId(req), req.params.id));
  if (!row) {
    sendError(res, 404, "Not one of your devices");
    return;
  }
  try {
    await sendWebPush(row, vapid, { title: "Test from Barista-Assistant", message: "Reminders will arrive like this.", url: null });
  } catch (err) {
    if (err instanceof PushGoneError) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
      sendError(res, 410, "This device is no longer subscribed, so it was removed");
      return;
    }
    sendError(res, 502, err instanceof NotificationError ? `The push service ${err.message}` : "Sending failed");
    return;
  }
  res.status(204).end();
});

notificationsRouter.put("/:kind", async (req: Request<KindParams>, res: Response<{ channel: ChannelSummary }>) => {
  const { kind } = req.params;
  if (!isKind(kind)) {
    sendError(res, 404, "Unknown notification service");
    return;
  }
  const body = parseBody(putBody, req, res);
  if (!body) return;
  const userId = authedUserId(req);
  const [existing] = await db.select().from(notificationChannels).where(own(userId, kind));
  const parsed = configSchemas[kind].safeParse(unmask(kind, body.config, existing?.config ?? null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    sendError(res, 400, `config.${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"}`);
    return;
  }
  if (existing) {
    await db.update(notificationChannels).set({ enabled: body.enabled, config: parsed.data }).where(eq(notificationChannels.id, existing.id));
  } else {
    await db.insert(notificationChannels).values({ id: randomUUID(), userId, kind, enabled: body.enabled, config: parsed.data });
  }
  const [row] = await db.select().from(notificationChannels).where(own(userId, kind));
  if (!row) throw new Error(`Channel ${kind} missing after save`);
  res.json({ channel: summarize(row) });
});

notificationsRouter.delete("/:kind", async (req: Request<KindParams>, res: Response) => {
  const { kind } = req.params;
  if (!isKind(kind)) {
    sendError(res, 404, "Unknown notification service");
    return;
  }
  const [result] = await db.delete(notificationChannels).where(own(authedUserId(req), kind));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Not set up");
    return;
  }
  res.status(204).end();
});

// Sends a test through the saved channel (enabled or not) and reports only
// whether it worked, with the service's status, never its response body.
notificationsRouter.post("/:kind/test", async (req: Request<KindParams>, res: Response) => {
  const { kind } = req.params;
  if (!isKind(kind)) {
    sendError(res, 404, "Unknown notification service");
    return;
  }
  const [row] = await db.select().from(notificationChannels).where(own(authedUserId(req), kind));
  if (!row) {
    sendError(res, 404, "Not set up");
    return;
  }
  try {
    await sendNotification(kind, row.config as NotificationConfigs[typeof kind], {
      title: "Test from Barista-Assistant",
      message: "Rate-later reminders will arrive like this.",
      url: null,
    });
  } catch (err) {
    sendError(res, 502, err instanceof NotificationError ? `The service ${err.message}` : "Sending failed");
    return;
  }
  res.status(204).end();
});
