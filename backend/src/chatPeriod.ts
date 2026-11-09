// A live Period attachment (docs/api/chat.md §12, "Periods"): the picker's
// Brews filters, kept on the message and run again by the worker for every
// reply. Used when sending and when importing chats.
import { CHAT_PERIOD_RANGES, isFixed, periodLabel, type ChatPeriodSpec } from "@barista/shared/chatPeriod";
import { beans, brewers, recipes } from "@barista/shared/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Not a date");

export const periodSpecSchema = z
  .object({
    range: z.enum(CHAT_PERIOD_RANGES),
    from: day.nullable(),
    to: day.nullable(),
    beanId: z.string().uuid().nullable(),
    recipeId: z.string().uuid().nullable(),
    brewerId: z.string().uuid().nullable(),
    mine: z.boolean(),
  })
  .strict()
  .refine((s) => (isFixed(s.range) ? s.from !== null && s.to !== null && s.from <= s.to : s.from === null && s.to === null), {
    message: "A week, month or custom period needs from and to (from first); the others take neither",
  });

// Its label, with the filters' names as they are now; null if one isn't in
// this workspace.
export async function labelPeriod(workspaceId: string, spec: ChatPeriodSpec): Promise<string | null> {
  const [bean, recipe, brewer] = await Promise.all([
    spec.beanId ? db.select({ name: beans.beanName }).from(beans).where(and(eq(beans.id, spec.beanId), eq(beans.workspaceId, workspaceId))) : Promise.resolve(null),
    spec.recipeId ? db.select({ name: recipes.name }).from(recipes).where(and(eq(recipes.id, spec.recipeId), eq(recipes.workspaceId, workspaceId))) : Promise.resolve(null),
    spec.brewerId ? db.select({ name: brewers.name }).from(brewers).where(and(eq(brewers.id, spec.brewerId), eq(brewers.workspaceId, workspaceId))) : Promise.resolve(null),
  ]);
  if ((bean && !bean[0]) || (recipe && !recipe[0]) || (brewer && !brewer[0])) return null;
  return periodLabel(spec, { bean: bean?.[0]?.name, recipe: recipe?.[0]?.name, brewer: brewer?.[0]?.name }).slice(0, 200);
}
