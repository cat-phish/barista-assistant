import type { Request, Response } from "express";
import type { z } from "zod";

export interface ErrorResponse {
  error: string;
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  extra?: Record<string, string | number>
): void {
  res.status(status).json({ ...extra, error: message } satisfies ErrorResponse);
}

// Validates req.body against a schema. On failure sends 400 and returns null.
export function parseBody<T extends z.ZodType>(
  schema: T,
  req: Pick<Request, "body">,
  res: Response
): z.infer<T> | null {
  return parseInput(schema, req.body, res);
}

// Same as parseBody, for the query string.
export function parseQuery<T extends z.ZodType>(
  schema: T,
  req: Pick<Request, "query">,
  res: Response
): z.infer<T> | null {
  return parseInput(schema, req.query, res);
}

function parseInput<T extends z.ZodType>(schema: T, input: unknown, res: Response): z.infer<T> | null {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".");
    sendError(res, 400, field ? `${field}: ${issue.message}` : (issue?.message ?? "Invalid request body"));
    return null;
  }
  return result.data;
}

// MariaDB unique-constraint violation; drizzle wraps the driver error in `cause`.
export function isDuplicateEntryError(err: unknown): boolean {
  const code = (e: unknown): unknown =>
    typeof e === "object" && e !== null && "code" in e ? e.code : undefined;
  const cause = typeof err === "object" && err !== null && "cause" in err ? err.cause : undefined;
  return code(err) === "ER_DUP_ENTRY" || code(cause) === "ER_DUP_ENTRY";
}
