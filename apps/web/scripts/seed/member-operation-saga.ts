// Seed a member operation the SAME way production does — through the
// invite-accept cascade (`features/invites/adapters/invites.actions.ts`
// `acceptInviteSaga`): `membership.created` + `member_operation.created` as ONE
// ACID transaction (`commitSaga`), then the PII sidecar (`member_operations_pii`)
// and the user's `currentOrgId` patch POST-commit (idempotent, outside the
// event-store tx).
//
// Note: `member_operation.activated` is NOT emitted — operational readiness is
// DERIVED on read (mobile present ∧ ≥1 unit ∧ ≥1 service), never an event
// (brief 0068 D4 / #1226). So an "incomplete" operator (no mobile on its User)
// is simply one whose derived status is not-ready — no separate activation step.

import type { CommissionRule, StoredMemberOperation, TaxIdentity } from '@/domain'
import { membershipDocId } from '@/domain'
import { MemberOperationConfig, MembershipConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx, type SagaStep } from '@/domain/effect'
import { upsertMemberOperationPii } from '@/shared/db/pg/pii-sidecars-store'
import { patchUser, putUser } from '@/shared/db/pg/users-store'
import { commitSaga } from '@/shared/effect-bridge'
import { buildMembership, buildUser } from '@/shared/fixtures/domain-builders'
import { newId } from './ids'

export interface SeedMemberOperationInput {
  orgId: string
  // A fixed member-operation id so re-runs reproduce the same row (and callers
  // can reference the operator deterministically, e.g. in appointments). Omit to
  // mint a random one (production-like).
  memberOperationId?: string
  userId: string
  displayName: string
  // A complete operator has a real mobile; omit (null) to seed the
  // "incomplete" operator whose derived operational status is not-ready.
  mobile: string | null
  unitIds: string[]
  catalogServiceIds: string[]
  defaultCommission?: CommissionRule | null
  taxIdentity?: TaxIdentity | null
  invitedBy: string
  now: string
}

// Persists the global `users/{uid}` identity (PII: displayName/mobile), then
// runs the membership+member-operation cascade, then the PII sidecar +
// currentOrgId patch — mirroring the production accept-invite ordering. Returns
// the new member-operation id.
export async function seedMemberOperation(input: SeedMemberOperationInput): Promise<string> {
  // 1. Global user identity (PII lives here, never in the event payload).
  await putUser(
    buildUser(input.userId, input.now, {
      displayName: input.displayName,
      completionCompleted: input.mobile !== null,
      mobile: input.mobile,
      currentOrgId: input.orgId,
    }),
  )

  const memberOperationId = input.memberOperationId ?? newId()
  const membership = buildMembership(input.orgId, input.userId, input.now, {
    role: 'member_operator',
    invitedBy: input.invitedBy,
  })
  const memberOperation: StoredMemberOperation = {
    id: memberOperationId,
    orgId: input.orgId,
    userId: input.userId,
    defaultCommission: input.defaultCommission ?? null,
    unitIds: input.unitIds,
    catalogServiceIds: input.catalogServiceIds,
    createdAt: input.now,
    updatedAt: input.now,
  }

  // 2. ACID cascade: membership + member operation in one transaction.
  const membershipStep: SagaStep = (tx) =>
    appendEventToTx(
      MembershipConfig,
      aggregateRef(MembershipConfig, input.orgId, membershipDocId(input.orgId, input.userId)),
      { _tag: 'membership.created', actorId: input.invitedBy, payload: { data: membership } },
      tx,
    )
  const memberOperationStep: SagaStep = (tx) =>
    appendEventToTx(
      MemberOperationConfig,
      aggregateRef(MemberOperationConfig, input.orgId, memberOperationId),
      {
        _tag: 'member_operation.created',
        actorId: input.invitedBy,
        payload: { data: memberOperation },
      },
      tx,
    )

  const outcome = await commitSaga([membershipStep, memberOperationStep])
  if (!outcome.ok) {
    throw new Error(`seedMemberOperation cascade failed for ${input.userId}: ${outcome.error}`)
  }

  // 3. Post-commit, non-aggregate writes (idempotent): PII sidecar + currentOrg.
  await upsertMemberOperationPii({
    orgId: input.orgId,
    id: memberOperationId,
    taxIdentity: input.taxIdentity ?? null,
  })
  await patchUser(input.userId, { current_org_id: input.orgId }, input.now)

  return memberOperationId
}
