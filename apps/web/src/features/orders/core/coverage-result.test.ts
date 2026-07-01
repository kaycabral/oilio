import { describe, expect, it } from 'vitest'
import { coverageDenialMessage, type CoverageDenialReason } from './coverage-result'

describe('coverageDenialMessage', () => {
  // Pin the exact copy per reason so a string-literal mutant (→ "") is killed and
  // every branch is exercised (#1324 — the message shown across the 3 entry points).
  // The `Record` makes this exhaustive at compile time (a new reason without an
  // entry fails to type), and the tuple list is already `CoverageDenialReason`, so
  // iterating it needs no `as` cast.
  const EXPECTED: Record<CoverageDenialReason, string> = {
    no_customer: 'Venda sem cliente não pode consumir assinatura',
    no_subscription: 'Cliente não possui assinatura ativa',
    not_in_catalog: 'Item não encontrado no catálogo',
    not_in_plan: 'Este item não está no plano do cliente',
    no_balance: 'Plano sem saldo restante neste ciclo',
  }

  // Typed list drives the cases with no cast. `satisfies` proves it covers every
  // reason (drop one → `EXPECTED[reason]` access below still compiles, but the
  // list is the single place to add a new reason's case).
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
