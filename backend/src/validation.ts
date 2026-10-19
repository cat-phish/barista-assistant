import { z } from "zod";
import { ROLES } from "./auth/membership.js";

export const roleSchema = z.enum(ROLES);

// Stored slugs always match this, so a param that doesn't can't be a real slug.
// Checking it also stops the case-insensitive collation matching "TEST-BAR" to "test-bar".
export const SLUG_PATTERN = /^[a-z0-9-]{3,64}$/;

export const emailSchema =z.string().trim().toLowerCase().pipe(z.email().max(255));

// A JSON number destined for a DECIMAL(p, scale) column (mode: "number").
// Rejects values with more than `scale` decimals so nothing is silently rounded.
export function decimalSchema(opts: {
  min: number;
  max: number;
  scale: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
}) {
  const { min, max, scale, exclusiveMin = false, exclusiveMax = false } = opts;
  return z
    .number()
    .refine((n) => (exclusiveMin ? n > min : n >= min), `must be ${exclusiveMin ? "greater than" : "at least"} ${min}`)
    .refine((n) => (exclusiveMax ? n < max : n <= max), `must be ${exclusiveMax ? "less than" : "at most"} ${max}`)
    .refine((n) => Number(n.toFixed(scale)) === n, `must have at most ${scale} decimal places`);
}

// Optional, nullable trimmed string; blank becomes null so "" isn't stored.
// The transform sits inside .optional() on a non-optional schema, so an absent
// key stays undefined (left untouched by an update) instead of becoming null.
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((s) => (s ? s : null))
    .optional();
}

// For PATCH bodies: reject {} and unknown keys.
export function updateSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");
}
