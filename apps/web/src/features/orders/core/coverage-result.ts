export type CoverageDenialReason =
  | 'no_customer'
  | 'no_subscription'
  | 'not_in_catalog'
  | 'not_in_plan'
  | 'no_balance'

export type CoverageResult =
  | { covered: true; subscriptionId: string }
  | { covered: false; reason: CoverageDenialReason }

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
