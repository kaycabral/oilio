import { ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx, type SagaStep } from '@/domain/effect'
import type { Charge } from '@/domain/types/charge'
import type { SubscriptionStatus } from '@/domain/types/subscription'
import type { ChargeAfterFailure } from '@/features/subscriptions/core/charge-failure'

/**
 * Pure step builders for the charge ↔ subscription cascades (#1200). Each turns
 * resolved cascade inputs into an ordered `SagaStep[]` — no I/O, no auth, no
 * Firestore — so the action just resolves state, calls a builder, and commits
 * the result (ACID on Postgres via `commitSaga`, sequential on Firestore). Same
 * shape as `order-saga.ts` / `offboard-saga.ts`. The step closures are exercised
 * by the in-memory-tx unit test and the `*.events.pg.integration.test.ts` suite.
 */

const chargeRef = (orgId: string, chargeId: string) => aggregateRef(ChargeConfig, orgId, chargeId)
const subscriptionRef = (orgId: string, subscriptionId: string) =>
  aggregateRef(SubscriptionConfig, orgId, subscriptionId)

interface MarkPaidInput {
  orgId: string
  actorId: string
  chargeId: string
  subscriptionId: string
  attempts: number
  now: string
  /**
   * Competência da receita reconhecida — o início do período de serviço coberto
   * (ADR 0016 D2), NÃO `now` (pagamento = caixa). Carregado no `changes` do
   * `charge.succeeded` pra o evento ser auto-suficiente na competência (simetria
   * com `order.closed` + items, ADR 0016 D5): o `occurred_at` deriva daqui.
   */
  periodStartAt: string
  /**
   * Snapshotted onto the `charge.succeeded` changeset for the SAME reason as
   * `periodStartAt` (ADR 0016 D5 self-sufficiency): the Razão reads the org+window
   * stream and derives subscription revenue from `charge.succeeded` ALONE, so the
   * amount + unit must live on the recognizing event, not be chased across the
   * `charge.created` snapshot. Both are the charge's current snapshot values — they
   * don't change the projected state (already true), they make the fact complete.
   */
  amountCents: number
  unitId: string
  /** A cancelled subscription is NOT settled — only the charge succeeds. */
  settle: boolean
}

/** `markChargePaid`: charge.succeeded then (unless cancelled) subscription.charge_settled. */
export function buildMarkPaidSteps(input: MarkPaidInput): SagaStep[] {
  const chargeSucceeded: SagaStep = (tx) =>
    appendEventToTx(
      ChargeConfig,
      chargeRef(input.orgId, input.chargeId),
      {
        _tag: 'charge.succeeded',
        actorId: input.actorId,
        payload: {
          changes: {
            status: 'paid',
            paidAt: input.now,
            failedAt: null,
            failureReason: null,
            attempts: input.attempts + 1,
            lastActorUid: input.actorId,
            updatedAt: input.now,
            // Competência da receita (ADR 0016 D2) — repetida no changeset pra o
            // evento ser auto-suficiente: `occurred_at` = período de serviço, não
            // o pagamento. Já é o valor atual do snapshot (não muda o estado).
            periodStartAt: input.periodStartAt,
            // Valor + unidade snapshotados no evento de reconhecimento (ADR 0016
            // D5): o Razão deriva a receita do `charge.succeeded` só, sem buscar o
            // `charge.created`. Já são os valores atuais (não mudam o estado).
            amountCents: input.amountCents,
            unitId: input.unitId,
          },
        },
      },
      tx,
    )
  const settleSubscription: SagaStep = (tx) =>
    appendEventToTx(
      SubscriptionConfig,
      subscriptionRef(input.orgId, input.subscriptionId),
      { _tag: 'subscription.charge_settled', actorId: input.actorId, payload: {} },
      tx,
    )
  return input.settle ? [chargeSucceeded, settleSubscription] : [chargeSucceeded]
}

interface MarkFailedInput {
  orgId: string
  actorId: string
  chargeId: string
  subscriptionId: string
  now: string
  nextChargeStatus: ChargeAfterFailure['status']
  nextChargeAttempts: number
  subStatus: SubscriptionStatus
  failureReason: string | null
}

/** `markChargeFailed`: charge.failed then subscription.charge_failed. */
export function buildMarkFailedSteps(input: MarkFailedInput): SagaStep[] {
  const chargeFailed: SagaStep = (tx) =>
    appendEventToTx(
      ChargeConfig,
      chargeRef(input.orgId, input.chargeId),
      {
        _tag: 'charge.failed',
        actorId: input.actorId,
        payload: {
          changes: {
            status: input.nextChargeStatus,
            failedAt: input.now,
            failureReason: input.failureReason,
            attempts: input.nextChargeAttempts,
            lastActorUid: input.actorId,
            updatedAt: input.now,
          },
        },
      },
      tx,
    )
  const subFailed: SagaStep = (tx) =>
    appendEventToTx(
      SubscriptionConfig,
      subscriptionRef(input.orgId, input.subscriptionId),
      {
        _tag: 'subscription.charge_failed',
        actorId: input.actorId,
        payload: { reason: input.failureReason ?? 'manual_mark', status: input.subStatus },
      },
      tx,
    )
  return [chargeFailed, subFailed]
}

interface RenewInput {
  orgId: string
  actorId: string
  subscriptionId: string
  charge: Charge
  periodStart: string
  periodEnd: string
  nextChargeDate: string
}

/** `renewSubscription`: charge.created (next cycle) then subscription.renewed. */
export function buildRenewSteps(input: RenewInput): SagaStep[] {
  const chargeCreated: SagaStep = (tx) =>
    appendEventToTx(
      ChargeConfig,
      chargeRef(input.orgId, input.charge.id),
      { _tag: 'charge.created', actorId: input.actorId, payload: { data: input.charge } },
      tx,
    )
  const renewed: SagaStep = (tx) =>
    appendEventToTx(
      SubscriptionConfig,
      subscriptionRef(input.orgId, input.subscriptionId),
      {
        _tag: 'subscription.renewed',
        actorId: input.actorId,
        payload: {
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          nextChargeDate: input.nextChargeDate,
        },
      },
      tx,
    )
  return [chargeCreated, renewed]
}
