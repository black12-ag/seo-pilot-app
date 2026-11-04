import { z } from "zod";

/** Marks a run paid for by the operator's own login, with no per-call price. */
export const INCLUDED_IN_SUBSCRIPTION = "included_in_subscription";
export const INCLUDED_IN_SUBSCRIPTION_LABEL = "included in subscription";
const SUBSCRIPTION_BACKEND_PREFIX = "subscription-";

const subscriptionRunSchema = z.object({
  aiEngine: z.object({
    billing: z.literal(INCLUDED_IN_SUBSCRIPTION),
    engine: z.string(),
    model: z.string(),
  }),
});

/** The engine and model behind a reply, or null for a priced API call. */
export function subscriptionRun(providerMetadata: unknown) {
  const parsed = subscriptionRunSchema.safeParse(providerMetadata);
  return parsed.success ? parsed.data.aiEngine : null;
}

type AccessShape = object | null;

function subscriptionEngine(access: AccessShape): string | null {
  if (!access || !("subscription" in access)) return null;
  const subscription = access.subscription;
  return typeof subscription === "object" &&
    subscription !== null &&
    "engine" in subscription &&
    typeof subscription.engine === "string"
    ? subscription.engine
    : null;
}

export const subscriptionBackendId = (engine: string) =>
  `${SUBSCRIPTION_BACKEND_PREFIX}${engine}`;

export const isSubscriptionBackend = (backendId: string | null) =>
  Boolean(backendId?.startsWith(SUBSCRIPTION_BACKEND_PREFIX));

export function aiBackendId(access: AccessShape): string | null {
  if (!access) return null;
  const engine = subscriptionEngine(access);
  return engine ? subscriptionBackendId(engine) : "openrouter";
}

export function aiAccessKind(access: AccessShape) {
  if (!access) return null;
  if (subscriptionEngine(access)) return "subscription" as const;
  return "apiKey" in access ? ("api_key" as const) : ("gateway" as const);
}
