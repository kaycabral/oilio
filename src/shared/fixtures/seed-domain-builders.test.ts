import {
  AgendaBlock,
  CashMovement,
  CatalogItem,
  Category,
  StoredOrg,
  StoredUnit,
  SubscriptionPlan,
} from '@/domain'
import { OpenOrder } from '@/domain/types/order'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  agendaAlwaysOpen,
  agendaAppointment,
  agendaFixed,
  buildAgendaBlockOneOff,
  buildAgendaBlockRecurring,
  buildCategory,
  buildExpenseMovement,
  buildOpenOrder,
  buildOrderItem,
  buildOrg,
  buildProductItem,
  buildSaleMovement,
  buildSangriaMovement,
  buildServiceItem,
  buildSubscriptionPlan,
  buildSuprimentoMovement,
  buildUnit,
  companyFiscal,
} from './seed-domain-builders'

const NOW = '2026-06-15T12:00:00.000Z'
const decodes = (schema: Schema.Decoder<unknown>, value: unknown): void => {
  expect(() => {
    Schema.decodeUnknownSync(schema)(value)
  }).not.toThrow()
}

describe('seed builders produce schema-valid docs', () => {
  it('buildOrg', () => {
    decodes(StoredOrg, buildOrg('o1', 'owner', NOW))
  })

  it('buildUnit — all three agenda modes + informal/company fiscal', () => {
    decodes(StoredUnit, buildUnit('u1', 'o1', NOW, { agenda: agendaFixed() }))
    decodes(StoredUnit, buildUnit('u1', 'o1', NOW, { agenda: agendaAlwaysOpen() }))
    decodes(StoredUnit, buildUnit('u1', 'o1', NOW, { agenda: agendaAppointment() }))
    decodes(
      StoredUnit,
      buildUnit('u1', 'o1', NOW, { fiscal: companyFiscal('12345678000190', NOW) }),
    )
  })

  it('buildCategory', () => {
    decodes(Category, buildCategory('cat1', 'o1', NOW))
  })

  it('buildServiceItem / buildProductItem — both union branches', () => {
    decodes(CatalogItem, buildServiceItem('svc1', 'o1', NOW))
    decodes(CatalogItem, buildProductItem('prod1', 'o1', NOW))
  })

  it('buildSubscriptionPlan — every billing cycle', () => {
    for (const billingCycle of ['monthly', 'quarterly', 'semiannual', 'annual'] as const) {
      decodes(SubscriptionPlan, buildSubscriptionPlan('p1', 'o1', NOW, { billingCycle }))
    }
  })

  it('buildAgendaBlock — recurring + one_off branches', () => {
    decodes(
      AgendaBlock,
      buildAgendaBlockRecurring({
        id: 'b1',
        orgId: 'o1',
        unitId: 'u1',
        weekday: 'monday',
        open: '12:00',
        close: '13:00',
        now: NOW,
      }),
    )
    decodes(
      AgendaBlock,
      buildAgendaBlockOneOff({
        id: 'b2',
        orgId: 'o1',
        unitId: 'u1',
        startAt: NOW,
        endAt: NOW,
        now: NOW,
      }),
    )
  })

  it('buildOpenOrder — totals sum the items', () => {
    const order = buildOpenOrder({
      id: 'ord1',
      orgId: 'o1',
      unitId: 'u1',
      customerId: 'c1',
      now: NOW,
      overrides: {
        items: [buildOrderItem('oi1', 'user1', { unitPriceCents: 4500, quantity: 2 })],
      },
    })
    expect(order.subtotalCents).toBe(9000)
    expect(order.totalCents).toBe(9000)
    decodes(OpenOrder, order)
  })

  it('buildCashMovement — every kind decodes with its fixed direction', () => {
    const common = {
      id: 'cm1',
      orgId: 'o1',
      unitId: 'u1',
      recordedByUid: 'user1',
      amountCents: 1000,
      now: NOW,
    }
    decodes(CashMovement, buildExpenseMovement(common, 'utilities'))
    decodes(CashMovement, buildSangriaMovement(common))
    decodes(CashMovement, buildSuprimentoMovement(common))
    decodes(CashMovement, buildSaleMovement(common, 'ord1', 'pix'))

    expect(buildSangriaMovement(common).direction).toBe('out')
    expect(buildSuprimentoMovement(common).direction).toBe('in')
    expect(buildSaleMovement(common, 'ord1', 'pix').direction).toBe('in')
  })
})
