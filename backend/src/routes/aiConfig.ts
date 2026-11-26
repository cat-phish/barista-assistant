// A workspace's own AI key and models (docs/api/workspaces.md §2d).
import { AI_FEATURES, AI_PROVIDERS, lastFour, overridesView, usableOverride, type AiFeature, type AiOverrides, type AiOverridesView, type AiProvider } from "@barista/shared/aiConfig";
import { workspaceAiConfigs } from "@barista/shared/schema";
import { encryptSecret } from "@barista/shared/secrets";
import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { aiStatus, sendAiCheck, type AiStatus } from "../aiConfig.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { requireMembership } from "../auth/membership.js";
import { config } from "../config.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";

const model = z.string().trim().min(1).max(100);
const optionalModel = model.nullable().optional();
export const aiKey = z.string().trim().min(8).max(500);

// Per feature (§2d "Per feature"): the whole map is sent, a feature left out
// has none. apiKey left out keeps the saved one (same provider), null drops it.
const overrideSchema = z.object({ provider: z.enum(AI_PROVIDERS), apiKey: aiKey.nullable().optional(), model: optionalModel }).strict();
export const overridesSchema = z.object(Object.fromEntries(AI_FEATURES.map((f) => [f, overrideSchema.optional()])) as Record<AiFeature, z.ZodOptional<typeof overrideSchema>>).strict();
export type OverridesInput = z.infer<typeof overridesSchema>;

export const FEATURE_NAMES: Record<AiFeature, string> = {
  analysis: "Brew analysis",
  suggest: "Suggest parameters",
  chat: "Chat",
  writing: "Reviews and recaps",
  label: "Label photos",
  web: "Web lookup",
};

// The saved map with the input applied, or why it can't be saved. A key
// needs the secret (checked by the caller); an override that adds nothing
// (same provider, no key, no model) isn't kept.
export function mergeOverrides(saved: AiOverrides | null | undefined, input: OverridesInput, defaultProvider: AiProvider, secret: string | null): { value: AiOverrides } | { error: string; status: number } {
  const value: AiOverrides = {};
  for (const f of AI_FEATURES) {
    const o = input[f];
    if (!o) continue;
    const before = saved?.[f];
    let apiKeyEncrypted: string | null = null;
    let apiKeyLast4: string | null = null;
    if (o.apiKey) {
      if (!secret) return { status: 409, error: "Keys can't be saved until AI_CONFIG_SECRET is set on the server" };
      apiKeyEncrypted = encryptSecret(o.apiKey, secret);
      apiKeyLast4 = lastFour(o.apiKey);
    } else if (o.apiKey === undefined && before?.provider === o.provider && before.apiKeyEncrypted) {
      ({ apiKeyEncrypted, apiKeyLast4 } = before);
    }
    const next = { provider: o.provider, apiKeyEncrypted, apiKeyLast4, model: o.model ?? null };
    if (!usableOverride(next, defaultProvider)) return { status: 400, error: `${FEATURE_NAMES[f]}: another provider needs its own API key and model` };
    if (next.provider === defaultProvider && !next.apiKeyEncrypted && !next.model) continue;
    value[f] = next;
  }
  return { value };
}

// Left out of a save: the saved ones that still stand with this provider.
export function keptOverrides(saved: AiOverrides | null | undefined, defaultProvider: AiProvider): AiOverrides {
  return Object.fromEntries(Object.entries(saved ?? {}).filter(([, o]) => usableOverride(o, defaultProvider)));
}

// Which key Test and the model list use: a feature's, or the main.
export const checkSchema = z.object({ feature: z.enum(AI_FEATURES).optional() }).strict();

// No base URL: only the server's admin says where requests go. strict()
// refuses one rather than dropping it.
const saveSchema = z
  .object({ provider: z.enum(AI_PROVIDERS), apiKey: aiKey.optional(), model, visionModel: optionalModel, webModel: optionalModel, overrides: overridesSchema.optional() })
  .strict();

export interface OwnAiConfig {
  provider: AiProvider;
  keyLast4: string;
  model: string;
  visionModel: string | null;
  webModel: string | null;
  overrides: AiOverridesView;
}
export interface AiConfigResponse extends AiStatus {
  own: OwnAiConfig | null; // owners only
  canSaveKeys: boolean;
}

type Params = { workspaceId: string };

async function view(workspaceId: string, owner: boolean): Promise<AiConfigResponse> {
  const [row] = owner ? await db.select().from(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId)) : [];
  const own = row ? { provider: row.provider, keyLast4: row.apiKeyLast4, model: row.model, visionModel: row.visionModel, webModel: row.webModel, overrides: overridesView(row.overrides) } : null;
  return { ...(await aiStatus(workspaceId)), own, canSaveKeys: config.aiConfigSecret !== null };
}

export const aiConfigRouter = Router({ mergeParams: true });
aiConfigRouter.use(requireAuth);

aiConfigRouter.get("/", async (req: Request<Params>, res: Response<AiConfigResponse>) => {
  const role = await requireMembership(res, authedUserId(req), req.params.workspaceId);
  if (role) res.json(await view(req.params.workspaceId, role === "owner"));
});

// A new key, or the settings around the one saved. A different provider
// needs its own key.
aiConfigRouter.put("/", async (req: Request<Params>, res: Response<AiConfigResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const body = parseBody(saveSchema, req, res);
  if (!body) return;
  const [saved] = await db.select().from(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId));
  if (!body.apiKey && (!saved || saved.provider !== body.provider)) {
    sendError(res, 400, "Enter the API key");
    return;
  }
  if (body.apiKey && !config.aiConfigSecret) {
    sendError(res, 409, "Keys can't be saved until AI_CONFIG_SECRET is set on the server");
    return;
  }
  const merged = body.overrides ? mergeOverrides(saved?.overrides, body.overrides, body.provider, config.aiConfigSecret) : { value: keptOverrides(saved?.overrides, body.provider) };
  if ("error" in merged) {
    sendError(res, merged.status, merged.error);
    return;
  }
  const values = {
    provider: body.provider,
    apiKeyEncrypted: body.apiKey ? encryptSecret(body.apiKey, config.aiConfigSecret!) : saved!.apiKeyEncrypted,
    apiKeyLast4: body.apiKey ? lastFour(body.apiKey) : saved!.apiKeyLast4,
    model: body.model,
    visionModel: body.visionModel ?? null,
    webModel: body.webModel ?? null,
    overrides: merged.value,
  };
  await db.insert(workspaceAiConfigs).values({ workspaceId, ...values }).onDuplicateKeyUpdate({ set: values });
  res.json(await view(workspaceId, true));
});

// On the saved key, so one has to be saved first.
for (const action of ["models", "test"] as const) {
  aiConfigRouter.post(`/${action}`, async (req: Request<Params>, res: Response) => {
    const { workspaceId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
    const body = parseBody(checkSchema, { body: req.body ?? {} }, res);
    if (!body) return;
    const [saved] = await db.select({ workspaceId: workspaceAiConfigs.workspaceId }).from(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId));
    if (!saved) {
      sendError(res, 409, "Save a key first");
      return;
    }
    await sendAiCheck(res, { workspaceId, action, ...(body.feature ? { feature: body.feature } : {}) });
  });
}

aiConfigRouter.delete("/", async (req: Request<Params>, res: Response<AiConfigResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  await db.delete(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId));
  res.json(await view(workspaceId, true));
});
