// An Insights chart attached to a chat message (docs/api/chat.md §12): its
// numbers as the browser worked them out, kept on the message as sent. Used
// when sending and when importing chats.
import { CHART_COLUMNS_MAX, CHART_ROWS_MAX } from "@barista/shared/schema";
import { z } from "zod";

const cell = z.union([z.string().max(200), z.number()]);
export const chartSnapshotSchema = z
  .object({
    tab: z.string().min(1).max(20),
    title: z.string().trim().min(1).max(200),
    note: z.string().max(1000).nullable(),
    filters: z.string().max(500),
    head: z.array(z.string().max(200)).min(1).max(CHART_COLUMNS_MAX),
    rows: z.array(z.array(cell).max(CHART_COLUMNS_MAX)).max(CHART_ROWS_MAX),
    cut: z.number().int().min(0).max(10_000_000),
  })
  .strict();
