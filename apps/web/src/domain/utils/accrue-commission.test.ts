// AC-02 (brief 0022 #999) — decisão pura de accrual por item no fechamento.
// Cobre: serviço comissionável gera snapshot com o valor da regra; produto sem
// comissão (`commission: null`) é pulado; consumo de assinatura não comissiona;
// regra que zera o valor não vira registro; comissão fixa usa o valor da regra.

import { describe, expect, it } from 'vitest'

import type { OrderItem } from '../types/order'
import { accrueCommissionForItem } from './order'

function item(overrides: Partial<OrderItem>): OrderItem {
  return {
    id: 'item-1',
    kind: 'service',
    refId: 'svc-1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
    attributedUserId: 'pro-1',
    coverage: 'sale',
    subscriptionId: null,
    ...overrides,
  }
}

describe('accrueCommissionForItem', () => {
  it('serviço comissionável → snapshot com valor da regra (50% de R$50 = R$25)', () => {
    const accrual = accrueCommissionForItem(item({}))
    expect(accrual).not.toBeNull()
    expect(accrual).toMatchObject({
      orderItemId: 'item-1',
      attributedUserId: 'pro-1',
      itemKind: 'service',
      itemName: 'Corte',
      itemTotalCents: 5000,
      commissionKind: 'percentage',
      commissionValue: 50,
      amountCents: 2500,
    })
  })

  it('snapshot multiplica pela quantidade (2× R$50, 50% = R$50)', () => {
    const accrual = accrueCommissionForItem(item({ quantity: 2 }))
    expect(accrual?.itemTotalCents).toBe(10_000)
    expect(accrual?.amountCents).toBe(5000)
  })

  it('comissão fixa usa o valor da regra em centavos, independente do preço', () => {
    const accrual = accrueCommissionForItem(
      item({ commission: { kind: 'fixed', value: 1500 }, unitPriceCents: 9999 }),
    )
    expect(accrual?.commissionKind).toBe('fixed')
    expect(accrual?.amountCents).toBe(1500)
  })

  it('produto sem comissão (commission: null) não gera registro', () => {
    expect(accrueCommissionForItem(item({ kind: 'product', commission: null }))).toBeNull()
  })

  it('consumo de assinatura não comissiona (0021 AC-09)', () => {
    expect(accrueCommissionForItem(item({ coverage: 'subscription' }))).toBeNull()
  })

  it('regra que zera o valor (0%) não vira registro', () => {
    expect(
      accrueCommissionForItem(item({ commission: { kind: 'percentage', value: 0 } })),
    ).toBeNull()
  })

  // Brief 0041 AC-11 — snapshot de identidade do profissional na apuração.
  it('snapshota o nome do membro resolvido (retenção de vínculo, art. 16)', () => {
    const accrual = accrueCommissionForItem(item({ attributedUserId: 'pro-1' }), (uid) =>
      uid === 'pro-1' ? 'Zé Profissional' : '',
    )
    expect(accrual?.attributedMemberName).toBe('Zé Profissional')
  })

  it('snapshot vazio (não lança) quando o membro não resolve', () => {
    const accrual = accrueCommissionForItem(item({ attributedUserId: 'ghost' }), () => '')
    expect(accrual?.attributedMemberName).toBe('')
  })

  it('sem resolver (default) o snapshot nasce vazio', () => {
    expect(accrueCommissionForItem(item({}))?.attributedMemberName).toBe('')
  })

  it('não chama o resolver quando não há membro atribuído', () => {
    let called = false
    const accrual = accrueCommissionForItem(item({ attributedUserId: '' }), () => {
      called = true
      return 'should-not-be-used'
    })
    expect(called).toBe(false)
    expect(accrual?.attributedMemberName).toBe('')
  })
})
