// Action result types for the order sagas, in a neutral module so the order
// action files share them without a cycle.

// `coverageNotice` (brief 0081 / #1324, AC-06): set on a SUCCESSFUL add when the
// item COULD have been covered by the customer's subscription but wasn't (no
// balance / not in plan / expired) — the item still enters as `sale`, and this
// carries the specific reason so the UI can explain WHY instead of silently
// falling back to full price. Absent when there's nothing to explain (covered, or
// no subscription context at all).
export type OrderMutationResult =
  | { ok: true; orderId: string; coverageNotice?: string }
  | { ok: false; error: string }

export type CloseOrderResult =
  | { ok: true; orderId: string; commissionsGenerated: number }
  | { ok: false; error: string }
