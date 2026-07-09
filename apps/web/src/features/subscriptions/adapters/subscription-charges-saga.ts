import { ChargeConfig, SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx, type SagaStep } from '@/domain/effect'
import type { Charge } from '@/domain/types/charge'
import type { SubscriptionStatus } from '@/domain/types/subscription'
import type { ChargeAfterFailure } from '@/features/subscriptions/core/charge-failure'

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
  periodStartAt: string
  amountCents: number
  unitId: string
  settle: boolean
}

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
            periodStartAt: input.periodStartAt,
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
