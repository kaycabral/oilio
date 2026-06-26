// Action result types for the subscription/charge sagas, in a neutral module so
// actions.ts and subscription-charges.ts both import them without a cycle.

export type SubscriptionMutationResult =
  | { ok: true; subscriptionId: string }
  | { ok: false; error: string }

export type ChargeMutationResult = { ok: true } | { ok: false; error: string }
