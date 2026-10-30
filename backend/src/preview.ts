// Previews (docs/api/analysis.md §8d): what an analysis or a suggestion
// would send, built by the worker (so it's what would really be sent) while
// the request waits.
import type { AiPreviewJobData } from "@barista/shared/jobs";
import type { Response } from "express";
import { sendError } from "./http.js";
import { JobTimeoutError, previewAiRequest, QueueUnavailableError } from "./queue.js";

export async function sendPreview(res: Response, data: AiPreviewJobData): Promise<void> {
  try {
    res.json({ request: await previewAiRequest(data) });
  } catch (err) {
    if (err instanceof QueueUnavailableError) {
      console.error("Could not queue AI preview:", err.message);
      sendError(res, 503, "Previews are temporarily unavailable. Try again shortly.");
      return;
    }
    if (err instanceof JobTimeoutError) {
      sendError(res, 504, "The worker didn't answer in time. Try again shortly.");
      return;
    }
    throw err;
  }
}
