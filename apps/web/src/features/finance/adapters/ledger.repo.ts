import 'server-only'

import { classifyLedger, type LedgerEntry, type LedgerFact } from '@/domain'
import { ChargeConfig } from '@/domain/aggregates/charge/config'
import { CommissionConfig } from '@/domain/aggregates/commission/config'
import { OrderConfig } from '@/domain/aggregates/order/config'
import type { FirestoreDoc } from '@/domain/effect'
import { decodeStreamEvent } from '@/domain/effect'
import { readOrgEventStream, type OrgEventRow } from '@/shared/db/pg/org-event-stream'

// Adapter do Razão (brief 0091, Onda 1; ADR 0016 D4). A ÚNICA reescrita da
// re-fundação: a fonte de verdade deixa de ser as projeções-snapshot
// (orders/commissions/charges) e passa a ser o EVENT STREAM imutável por
// competência. Este é o Anti-Corruption Layer — traduz cada evento persistido
// (transporte) num `LedgerFact` (domínio) e delega a classificação pura a
// `classifyLedger`. Nenhuma regra de classificação mora aqui (CLAUDE.md do
// domínio): o adapter só decodifica + mapeia + correlaciona via a lib pura.
//
// A projeção vira cache reconstruível (nunca mais uma fonte paralela): se um dia
// somarmos algo, é a partir DESTE Razão, derivado do stream. O `occurred_at` de
// cada evento (materializado no append por `competenceOf`) é a competência —
// então a janela `[fromIso,toIso)` é por FATO GERADOR, não por data de gravação.

export type LedgerWindow = {
  readonly orgId: string
  readonly fromIso: string
  readonly toIso: string
}

// Mapeia um evento persistido do stream num `LedgerFact` (ou null pra eventos que
// não compõem o Razão). O envelope é decodificado com upcaster via
// `decodeStreamEvent` — o MESMO caminho do replay, então um evento v1 legado é
// elevado antes de virar fato (sem drift replay↔Razão). O `org_id` vem da linha
// do banco (identidade da tabela), não do payload.
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
          // Valor a estornar + unidade vêm SNAPSHOTADOS no próprio evento (ADR 0016
          // D5) — a venda original pode ter fechado fora da janela lida, então o
          // núcleo não pode correlacioná-los da comanda fechada in-window.
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
      // `commission.created` carrega o `Commission` COMPLETO (snapshot por item):
      // orgId, orderId, orderItemId, amountCents, createdAt (= closedAt). A
      // unidade NÃO está aqui — o núcleo a herda do `order.closed` correlato.
      return { kind: 'commission', commission: event.data }
    }
    case 'charge.succeeded': {
      const event = decodeStreamEvent(ChargeConfig, row.envelope)
      if (event._tag !== 'charge.succeeded') return null
      // O changeset do `charge.succeeded` carrega amountCents + unitId +
      // periodStartAt snapshotados (ADR 0016 D5) — o fato é auto-suficiente. Os
      // demais campos do `Charge` não são lidos pela classificação de receita.
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

// Reconstrói o `Charge` mínimo que a classificação de receita/estorno consome, a
// partir do changeset auto-suficiente do evento + a identidade da linha. Campos
// não usados pela classificação recebem neutros de schema (o Razão só lê
// amountCents/unitId/periodStartAt/refundedAt/status).
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

/**
 * Lê o Razão de uma org numa janela de competência. A entrada de TODO corte
 * financeiro (features/finance/core/cuts.ts): stream → fatos → `classifyLedger`.
 * A correlação (comissão herda unidade/competência da comanda; reopen estorna a
 * receita reconhecida) é feita pelo núcleo puro sobre a lista inteira — por isso
 * lemos o stream da janela de uma vez, não fato a fato.
 */
export async function readOrgLedger(window: LedgerWindow): Promise<LedgerEntry[]> {
  const rows = await readOrgEventStream(window)
  const facts: LedgerFact[] = []
  for (const row of rows) {
    const fact = rowToFact(row)
    if (fact) facts.push(fact)
  }
  return classifyLedger(facts)
}
