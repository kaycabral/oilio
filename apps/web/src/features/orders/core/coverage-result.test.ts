import { describe, expect, it } from 'vitest'
import { coverageDenialMessage, type CoverageDenialReason } from './coverage-result'

describe('coverageDenialMessage', () => {
  // Pin the exact copy per reason so a string-literal mutant (→ "") is killed and
  // every branch is exercised (#1324 — the message shown across the 3 entry points).
  const EXPECTED: Record<CoverageDenialReason, string> = {
    no_customer: 'Venda sem cliente não pode consumir assinatura',
    no_subscription: 'Cliente não possui assinatura ativa',
    not_in_catalog: 'Item não encontrado no catálogo',
    not_in_plan: 'Este item não está no plano do cliente',
    no_balance: 'Plano sem saldo restante neste ciclo',
  }

  for (const reason of Object.keys(EXPECTED) as CoverageDenialReason[]) {
    it(`returns the specific message for ${reason}`, () => {
      expect(coverageDenialMessage(reason)).toBe(EXPECTED[reason])
    })
  }
})
