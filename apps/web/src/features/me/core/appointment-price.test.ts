import type { OrderItem } from '@/domain'
import { describe, expect, it } from 'vitest'
import { appointmentPriceLabel } from './appointment-price'

// `toLocaleString('pt-BR', { currency })` separates "R$" from the digits with a
// non-breaking space (U+00A0). Collapse any whitespace so the assertions read
// naturally regardless of the ICU spacing.
const money = (label: string): string => label.replace(/\s+/g, ' ')

function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'it-1',
    kind: 'service',
    refId: 'svc-1',
    name: 'Corte',
    quantity: 1,
    unitPriceCents: 4500,
    commission: null,
    attributedUserId: 'u-1',
    ...overrides,
  }
}

describe('appointmentPriceLabel (#1329)', () => {
  it('falls back to the service snapshot when there is no closed order', () => {
    // Scheduled appointment: no order yet, the snapshot is the estimate.
    expect(
      money(appointmentPriceLabel({ servicePriceCentsSnapshot: 4500, closedOrder: null })),
    ).toBe('R$ 45,00')
  })

  it('reads "Coberto pelo plano" when every item is subscription-covered', () => {
    // The customer paid nothing — the plan absorbed it. The list price (R$45)
    // must NOT show; that was the bug.
    const label = appointmentPriceLabel({
      servicePriceCentsSnapshot: 4500,
      closedOrder: { items: [item({ coverage: 'subscription' })], discountCents: 0 },
    })
    expect(label).toBe('Coberto pelo plano')
  })

  it('reads "Coberto pelo plano" when the sale total nets to zero', () => {
    // Sale item fully discounted → nothing charged reads as covered/zero, not
    // the list price.
    const label = appointmentPriceLabel({
      servicePriceCentsSnapshot: 4500,
      closedOrder: {
        items: [item({ coverage: 'sale', unitPriceCents: 4500 })],
        discountCents: 4500,
      },
    })
    expect(label).toBe('Coberto pelo plano')
  })

  it('shows the real charged total for a sale item, not the snapshot', () => {
    // Paid as a sale but discounted: the history shows what was charged
    // (R$40), not the R$45 list price.
    const label = appointmentPriceLabel({
      servicePriceCentsSnapshot: 4500,
      closedOrder: {
        items: [item({ coverage: 'sale', unitPriceCents: 4500 })],
        discountCents: 500,
      },
    })
    expect(money(label)).toBe('R$ 40,00')
  })

  it('sums sale items and ignores covered ones in the charged total', () => {
    const label = appointmentPriceLabel({
      servicePriceCentsSnapshot: 4500,
      closedOrder: {
        items: [
          item({ id: 'a', coverage: 'sale', unitPriceCents: 4500 }),
          item({ id: 'b', coverage: 'subscription', unitPriceCents: 3000 }),
        ],
        discountCents: 0,
      },
    })
    expect(money(label)).toBe('R$ 45,00')
  })
})
