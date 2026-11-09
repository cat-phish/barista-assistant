import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { periodOf, RECAP_KINDS, type RecapKind } from "@barista/shared/recapPeriods";
import { DEFAULT_PREFERENCES, DEFAULT_WORKSPACE_SETTINGS, RECAP_SCOPES, recaps, users, withDefaults, workspaces, type RecapRow, type RecapScope } from "@barista/shared/schema";
import { requireAi } from "../aiConfig.js";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { enqueueRecapSummary, QueueUnavailableError } from "../queue.js";

// A recap's AI summary (docs/api/recaps.md §11c, "AI summary"): asked for
// with POST, polled with GET. The figures themselves are worked out by the
// client; only the summary is stored.

export interface RecapView {
  kind: RecapKind;
  periodStart: string;
  scope: RecapScope;
  status: "none" | "pending" | "done" | "failed";
  summary: string | null;
  highlights: string[];
  error: string | null;
  updatedAt: string;
}
export interface RecapResponse {
  recap: RecapView | null; // null: never asked for (and not notified)
}

interface WorkspaceParams {
  workspaceId: string;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date YYYY-MM-DD");
const keySchema = z.object({ kind: z.enum(RECAP_KINDS), periodStart: day, scope: z.enum(RECAP_SCOPES) }).strict();

const COLUMNS = {
  kind: recaps.kind,
  periodStart: recaps.periodStart,
  scope: recaps.scope,
  status: recaps.status,
  summary: recaps.summary,
  highlights: recaps.highlights,
  error: recaps.error,
  updatedAt: recaps.updatedAt,
};
type Row = Pick<RecapRow, keyof typeof COLUMNS>;
const view = (r: Row): RecapView => ({ ...r, highlights: r.highlights ?? [], updatedAt: r.updatedAt.toISOString() });

const keyOf = (workspaceId: string, userId: string, k: z.infer<typeof keySchema>) =>
  and(eq(recaps.workspaceId, workspaceId), eq(recaps.userId, userId), eq(recaps.kind, k.kind), eq(recaps.periodStart, k.periodStart), eq(recaps.scope, k.scope));

// Today in a zone, YYYY-MM-DD.
function todayIn(zone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export const recapsRouter = Router({ mergeParams: true });
recapsRouter.use(requireAuth);

// The caller's summary for one period, or null.
recapsRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<RecapResponse>) => {
  const { workspaceId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId))) return;
  const parsed = keySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return;
  }
  const [row] = await db.select(COLUMNS).from(recaps).where(keyOf(workspaceId, userId, parsed.data));
  res.json({ recap: row ? view(row) : null });
});

// Write (or rewrite) the summary: queued; 409 with no AI or the summary off.
recapsRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<RecapResponse>) => {
  const { workspaceId } = req.params;
  const userId = authedUserId(req);
  if (!(await requireMembership(res, userId, workspaceId, WRITE_ROLES))) return;
  const body = parseBody(keySchema, req, res);
  if (!body) return;
  const [[user], [ws]] = await Promise.all([
    db.select({ preferences: users.preferences }).from(users).where(eq(users.id, userId)),
    db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)),
  ]);
  const prefs = withDefaults(DEFAULT_PREFERENCES, user?.preferences ?? null);
  if (prefs.recapAi === "off") {
    sendError(res, 409, "AI summaries are off (Settings → Recaps)", { code: "recap_ai_off" });
    return;
  }
  const period = periodOf(body.kind, body.periodStart, prefs.weekStartsOn);
  if (period.start !== body.periodStart) {
    sendError(res, 400, `periodStart: not the start of a ${body.kind === "weekly" ? "week" : "month"} (weeks start on your chosen day)`);
    return;
  }
  const zone = prefs.timeZone ?? withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws?.settings ?? null).timeZone;
  if (period.end >= todayIn(zone)) {
    sendError(res, 409, "This period hasn't ended yet", { code: "recap_in_progress" });
    return;
  }
  if (!(await requireAi(res, workspaceId))) return;

  const key = keyOf(workspaceId, userId, body);
  const [existing] = await db.select({ id: recaps.id, status: recaps.status }).from(recaps).where(key);
  if (existing?.status === "pending") {
    const [row] = await db.select(COLUMNS).from(recaps).where(key);
    res.status(202).json({ recap: row ? view(row) : null });
    return;
  }
  const id = existing?.id ?? randomUUID();
  if (existing) await db.update(recaps).set({ status: "pending", error: null, updatedAt: new Date() }).where(eq(recaps.id, id));
  else await db.insert(recaps).values({ id, workspaceId, userId, kind: body.kind, periodStart: body.periodStart, scope: body.scope, status: "pending" });
  try {
    await enqueueRecapSummary(id);
  } catch (err) {
    if (err instanceof QueueUnavailableError) {
      await db.update(recaps).set({ status: existing?.status ?? "none", updatedAt: new Date() }).where(eq(recaps.id, id));
      sendError(res, 503, "Summaries are temporarily unavailable. Try again shortly.");
      return;
    }
    throw err;
  }
  const [row] = await db.select(COLUMNS).from(recaps).where(eq(recaps.id, id));
  res.status(202).json({ recap: row ? view(row) : null });
});
