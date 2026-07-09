import { describe, expect, it } from 'vitest'
import { coverageDenialMessage, type CoverageDenialReason } from './coverage-result'

describe('coverageDenialMessage', () => {
  const EXPECTED: Record<CoverageDenialReason, string> = {
    no_customer: 'Venda sem cliente não pode consumir assinatura',
    no_subscription: 'Cliente não possui assinatura ativa',
    not_in_catalog: 'Item não encontrado no catálogo',
    not_in_plan: 'Este item não está no plano do cliente',
    no_balance: 'Plano sem saldo restante neste ciclo',
  }

  const REASONS = [
    'no_customer',
    'no_subscription',
    'not_in_catalog',
    'not_in_plan',
    'no_balance',
  ] satisfies CoverageDenialReason[]

  for (const reason of REASONS) {
    it(`returns the specific message for ${reason}`, () => {
      expect(coverageDenialMessage(reason)).toBe(EXPECTED[reason])
    })
  }
})
