export type OrderMutationResult =
  | { ok: true; orderId: string; coverageNotice?: string }
  | { ok: false; error: string }

export type CloseOrderResult =
  | { ok: true; orderId: string; commissionsGenerated: number }
  | { ok: false; error: string }
