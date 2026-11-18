// Queues learning preferences (docs/api/llm-contract.md §9g) after an
// analysis, for a person who learns automatically. Never fails the job it
// follows; the backend queues it after likes and dislikes.
import { eq } from "drizzle-orm";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { withPreferenceDefaults } from "@barista/shared/aiPreferences";
import { LEARN_DELAY_MS, PREFERENCES_JOB, PREFERENCES_QUEUE, preferencesJobId, type PreferencesJobData } from "@barista/shared/jobs";
import { userPreferences, users } from "@barista/shared/schema";
import type { AiDetail } from "@barista/shared/aiDetails";
import { config } from "./config.js";
import { db } from "./db.js";
import { isWorkspaceMember } from "./preferences.js";

let queue: Queue<PreferencesJobData> | null = null;
function preferencesQueue(): Queue<PreferencesJobData> {
  queue ??= new Queue<PreferencesJobData>(PREFERENCES_QUEUE, {
    connection: new Redis(config.redis.url, { maxRetriesPerRequest: null, ...(config.redis.password ? { password: config.redis.password } : {}) }),
  });
  return queue;
}
export async function closeLearnQueue(): Promise<void> {
  await queue?.close();
}

export async function learnAfterAnalysis(userId: string | null, workspaceId: string, hidden: ReadonlySet<AiDetail>): Promise<void> {
  if (!userId || hidden.has("learnedPreferences")) return;
  try {
    const [row] = await db.select({ p: users.aiPreferences, preferences: users.preferences }).from(users).where(eq(users.id, userId));
    if (!row || withPreferenceDefaults(row.p).learn !== "auto" || !userPreferences(row.preferences ?? null).learnAboutMe) return;
    if (!(await isWorkspaceMember(userId, workspaceId))) return; // SEC-20
    await preferencesQueue().add(PREFERENCES_JOB, { userId, workspaceId }, {
      jobId: preferencesJobId(userId, workspaceId),
      delay: LEARN_DELAY_MS,
      attempts: 2,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  } catch (err) {
    console.error("Couldn't queue learning preferences:", err instanceof Error ? err.message : err);
  }
}
