import 'server-only'

import { classifyLedger, DEFAULT_UNIT_TIMEZONE, type LedgerEntry, type LedgerFact } from '@/domain'
import { ChargeConfig } from '@/domain/aggregates/charge/config'
import { CommissionConfig } from '@/domain/aggregates/commission/config'
import { OrderConfig } from '@/domain/aggregates/order/config'
import type { FirestoreDoc } from '@/domain/effect'
import { decodeStreamEvent } from '@/domain/effect'
import {
  readActiveFixedCosts,
  readFixedCostOverrides,
} from '@/features/finance/adapters/fixed-costs.repo'
import { expandFixedCosts } from '@/features/finance/core/expand-fixed-costs'
import { readOrgEventStream, type OrgEventRow } from '@/shared/db/pg/org-event-stream'
import { listUnitTimezones } from '@/shared/org/unit-read'

export type LedgerWindow = {
  readonly orgId: string
  readonly fromIso: string
  readonly toIso: string
}

function rowToFact(row: OrgEventRow): LedgerFact | null {
  const tag = readTag(row.envelope)
  switch (tag) {
    case 'order.closed': {
      const event = decodeStreamEvent(OrderConfig, row.envelope)
      if (event._tag !== 'order.closed') return null
      return {
        kind: 'order_closed',
        order: {
          id: row.aggregateId,
          orgId: row.orgId,
          unitId: event.unitId,
          closedAt: event.closedAt,
          items: event.items,
        },
      }
    }
    case 'order.reopened': {
      const event = decodeStreamEvent(OrderConfig, row.envelope)
      if (event._tag !== 'order.reopened') return null
      return {
        kind: 'order_reopened',
        reopen: {
          orderId: row.aggregateId,
          orgId: row.orgId,
          unitId: event.unitId,
          reopenedAt: event.reopenedAt,
          reversedClosedAt: event.reversedClosedAt,
          reversedRevenueCents: event.reversedRevenueCents,
        },
      }
    }
    case 'commission.created': {
      const event = decodeStreamEvent(CommissionConfig, row.envelope)
      if (event._tag !== 'commission.created') return null
      return { kind: 'commission', commission: event.data }
    }
    case 'charge.succeeded': {
      const event = decodeStreamEvent(ChargeConfig, row.envelope)
      if (event._tag !== 'charge.succeeded') return null
      return buildChargeFact('charge_succeeded', row, event.changes)
    }
    case 'charge.refunded': {
      const event = decodeStreamEvent(ChargeConfig, row.envelope)
      if (event._tag !== 'charge.refunded') return null
      return buildChargeFact('charge_refunded', row, event.changes)
    }
    default:
      return null
  }
}

function buildChargeFact(
  kind: 'charge_succeeded' | 'charge_refunded',
  row: OrgEventRow,
  changes: Partial<{
    amountCents: number
    unitId: string
    periodStartAt: string
    refundedAt: string | null
    status: string
  }>,
): LedgerFact | null {
  const amountCents = changes.amountCents ?? 0
  const periodStartAt = changes.periodStartAt ?? row.occurredAt
  const refundedAt = changes.refundedAt ?? (kind === 'charge_refunded' ? row.occurredAt : null)
  const charge = {
    id: row.aggregateId,
    orgId: row.orgId,
    unitId: changes.unitId ?? '',
    subscriptionId: '',
    customerId: '',
    amountCents,
    periodStartAt,
    periodEndAt: periodStartAt,
    dueDate: periodStartAt,
    status: kind === 'charge_refunded' ? ('refunded' as const) : ('paid' as const),
    attempts: 0,
    paidAt: kind === 'charge_succeeded' ? row.occurredAt : null,
    failedAt: null,
    failureReason: null,
    refundedAt,
    lastActorUid: null,
    createdAt: row.occurredAt,
    updatedAt: row.occurredAt,
  }
  return kind === 'charge_succeeded'
    ? { kind: 'charge_succeeded', charge }
    : { kind: 'charge_refunded', charge }
}

function readTag(envelope: FirestoreDoc): string {
  const tag = envelope['_tag']
  return typeof tag === 'string' ? tag : ''
}

export async function readOrgLedger(window: LedgerWindow): Promise<LedgerEntry[]> {
  const [rows, fixedCostFacts] = await Promise.all([
    readOrgEventStream(window),
    readFixedCostFacts(window),
  ])
  const facts: LedgerFact[] = []
  for (const row of rows) {
    const fact = rowToFact(row)
    if (fact) facts.push(fact)
  }
  facts.push(...fixedCostFacts)
  return classifyLedger(facts)
}

async function readFixedCostFacts(window: LedgerWindow): Promise<LedgerFact[]> {
  const [costs, overrides, unitTimezones] = await Promise.all([
    readActiveFixedCosts(window.orgId),
    readFixedCostOverrides(window.orgId),
    listUnitTimezones(window.orgId),
  ])
  if (costs.length === 0) return []

  const tzByUnit = new Map(unitTimezones.map((u) => [u.id, u.timezone]))
  const facts = expandFixedCosts({
    fromIso: window.fromIso,
    toIso: window.toIso,
    costs,
    overrides,
    timezoneForUnit: (unitId) => tzByUnit.get(unitId) ?? DEFAULT_UNIT_TIMEZONE,
  })
  return facts.map((fixedCost) => ({ kind: 'fixed_cost', fixedCost }))
}
