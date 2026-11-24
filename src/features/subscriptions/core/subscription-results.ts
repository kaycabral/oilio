export type SubscriptionMutationResult =
  { ok: true; subscriptionId: string } | { ok: false; error: string }

export type ChargeMutationResult = { ok: true } | { ok: false; error: string }
