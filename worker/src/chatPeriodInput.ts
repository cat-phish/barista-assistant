// A live Period attachment as the AI sees it (docs/api/chat.md §12,
// "Periods"; llm-contract.md §9e): its filters run again for this reply
// through loadPeriodContext, in full as chat attachments are.
import { resolveChatPeriod, type ChatPeriodSpec, periodFiltersLabel } from "@barista/shared/chatPeriod";
import { beans, brewers, DEFAULT_WORKSPACE_SETTINGS, recipes, withDefaults, workspaces } from "@barista/shared/schema";
import { and, eq } from "drizzle-orm";
import { db } from "./db.js";
import { localBrewDate } from "./localDate.js";
import { loadPeriodContext } from "./periodContext.js";
import { toPeriodInput, type LlmInput } from "./prompt.js";
import { settingsZone } from "./zone.js";

const NOTHING_HIDDEN = new Set<never>();

// Whose chat it is (for Only mine) and their own cap, if lower.
export interface PeriodOwner {
  userId: string | null;
  periodMaxBrews?: number | null;
}

// The name of each filter, read now from this workspace; null: one is gone.
async function filterNames(spec: ChatPeriodSpec, workspaceId: string): Promise<{ bean: string | null; recipe: string | null; brewer: string | null } | null> {
  const [bean, recipe, brewer] = await Promise.all([
    spec.beanId ? db.select({ roaster: beans.roasterName, name: beans.beanName }).from(beans).where(and(eq(beans.id, spec.beanId), eq(beans.workspaceId, workspaceId))) : Promise.resolve(null),
    spec.recipeId ? db.select({ name: recipes.name }).from(recipes).where(and(eq(recipes.id, spec.recipeId), eq(recipes.workspaceId, workspaceId))) : Promise.resolve(null),
    spec.brewerId ? db.select({ name: brewers.name }).from(brewers).where(and(eq(brewers.id, spec.brewerId), eq(brewers.workspaceId, workspaceId))) : Promise.resolve(null),
  ]);
  if ((bean && !bean[0]) || (recipe && !recipe[0]) || (brewer && !brewer[0])) return null;
  return {
    bean: bean?.[0] ? `${bean[0].roaster} – ${bean[0].name}` : null,
    recipe: recipe?.[0]?.name ?? null,
    brewer: brewer?.[0]?.name ?? null,
  };
}

// The cap: the workspace's, or the person's own when it's lower.
export const periodCap = (workspaceMax: number, own: number | null | undefined): number => (own ? Math.min(workspaceMax, own) : workspaceMax);

export async function periodInput(spec: ChatPeriodSpec, workspaceId: string, owner: PeriodOwner, now = new Date()): Promise<LlmInput | null> {
  if (spec.mine && !owner.userId) return null;
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) return null;
  const settings = withDefaults(DEFAULT_WORKSPACE_SETTINGS, ws.settings);
  const names = await filterNames(spec, workspaceId);
  if (!names) return null;
  const today = localBrewDate(now, null, settingsZone(ws.settings));
  const { period, previous } = resolveChatPeriod(spec, today);
  const context = await loadPeriodContext({
    workspaceId,
    userId: spec.mine ? owner.userId : null,
    kind: "custom",
    period,
    previous,
    beanId: spec.beanId,
    recipeId: spec.recipeId,
    brewerId: spec.brewerId,
    filters: periodFiltersLabel(spec, names) || null,
    maxBrews: periodCap(settings.chatPeriodMaxBrews, owner.periodMaxBrews),
  });
  return toPeriodInput(context, NOTHING_HIDDEN);
}
