// Action result types for the order sagas, in a neutral module so the order
// action files share them without a cycle.

export type OrderMutationResult = { ok: true; orderId: string } | { ok: false; error: string }

export type CloseOrderResult =
  | { ok: true; orderId: string; commissionsGenerated: number }
  | { ok: false; error: string }
