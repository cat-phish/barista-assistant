import { z } from "zod";
import { METHOD_KINDS, RECIPE_STYLES, STYLES_BY_KIND, type GrinderStartingPoint, type MethodKind } from "@barista/shared/schema";
import { grindSettingSchema } from "./validation.js";

// A grinder's starting points and the methods it can't do
// (docs/api/grinders.md §3b, "Starting points"). Shared by the grinder routes
// and the backup check, so both accept the same values.
export const MAX_STARTING_POINTS = 20;

const startingPointSchema = z
  .object({ method: z.enum(METHOD_KINDS), style: z.enum(RECIPE_STYLES).nullable(), setting: grindSettingSchema })
  .strict();

export const startingPointsSchema = z
  .array(startingPointSchema)
  .max(MAX_STARTING_POINTS)
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (row.style !== null && (row.style === "other" || !STYLES_BY_KIND[row.method].includes(row.style))) {
        ctx.addIssue({ code: "custom", path: [i, "style"], message: `not a style of ${row.method}` });
      }
      const key = `${row.method}/${row.style ?? ""}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: [i], message: "listed twice" });
      seen.add(key);
    });
  }) satisfies z.ZodType<GrinderStartingPoint[]>;

export const unavailableMethodsSchema = z
  .array(z.enum(METHOD_KINDS))
  .refine((list) => new Set(list).size === list.length, "listed twice") satisfies z.ZodType<MethodKind[]>;

// Stored as null when empty, so "none" has one form.
export const emptyAsNull = <T>(list: T[] | null | undefined): T[] | null | undefined => (list && list.length === 0 ? null : list);
