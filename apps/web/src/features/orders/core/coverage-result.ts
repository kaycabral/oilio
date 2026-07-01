// Structured outcome of resolving whether an order item can be covered by the
// customer's subscription (brief 0081 / #1324 — AC-06). Before, the resolver
// returned `{ subscriptionId } | string` and callers DISCARDED the string, so a
// covered item silently fell back to `sale` with no reason surfaced. This makes
// the denial reason explicit and tagged, so the UI can show WHY across the three
// entry points (balcão, recepção, self-book) with one shared vocabulary — no
// silent full-price fallback.

// - no_customer: comanda sem cliente vinculado
// - no_subscription: cliente sem assinatura ativa (inclui expirada)
// - not_in_catalog: item não existe no catálogo
// - not_in_plan: item existe mas não está coberto pelo plano
// - no_balance: plano por contagem sem saldo restante no ciclo
export type CoverageDenialReason =
  | 'no_customer'
  | 'no_subscription'
  | 'not_in_catalog'
  | 'not_in_plan'
  | 'no_balance'

export type CoverageResult =
  | { covered: true; subscriptionId: string }
  | { covered: false; reason: CoverageDenialReason }

// Human, front-desk-facing message per denial reason (pt-BR). Single source so the
// same wording shows in the balcão, na agenda pela recepção e no self-book — a
// mensagem de motivo padronizada que o AC-06 exige.
export function coverageDenialMessage(reason: CoverageDenialReason): string {
  switch (reason) {
    case 'no_customer':
      return 'Venda sem cliente não pode consumir assinatura'
    case 'no_subscription':
      return 'Cliente não possui assinatura ativa'
    case 'not_in_catalog':
      return 'Item não encontrado no catálogo'
    case 'not_in_plan':
      return 'Este item não está no plano do cliente'
    case 'no_balance':
      return 'Plano sem saldo restante neste ciclo'
  }
}
