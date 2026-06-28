// Seed a professional the SAME way production does — through the invite-accept
// cascade (`features/invites/adapters/invites.actions.ts` `acceptInviteSaga`):
// `membership.created` + `professional.created` as ONE ACID transaction
// (`commitSaga`), then the PII sidecar (`professionals_pii`) and the user's
// `currentOrgId` patch POST-commit (idempotent, outside the event-store tx).
//
// Note: `professional.activated` is NOT emitted — operational readiness is
// DERIVED on read (whatsapp present ∧ ≥1 unit ∧ ≥1 service), never an event
// (brief 0068 D4 / #1226). So an "incomplete" pro (no whatsapp on its User) is
// simply a pro whose derived status is not-ready — no separate activation step.

import type { CommissionRule, StoredProfessional, TaxIdentity } from '@/domain'
import { membershipDocId } from '@/domain'
import { MembershipConfig, ProfessionalConfig } from '@/domain/aggregates'
import { aggregateRef, appendEventToTx, type SagaStep } from '@/domain/effect'
import { upsertProfessionalPii } from '@/shared/db/pg/pii-sidecars-store'
import { patchUser, putUser } from '@/shared/db/pg/users-store'
import { commitSaga } from '@/shared/effect-bridge'
import { buildMembership, buildUser } from '@/shared/fixtures/domain-builders'
import { newId } from './ids'

export interface SeedProfessionalInput {
  orgId: string
  // A fixed professional id so re-runs reproduce the same row (and callers can
  // reference the pro deterministically, e.g. in appointments). Omit to mint a
  // random one (production-like).
  professionalId?: string
  userId: string
  displayName: string
  // A complete pro has a real whatsapp; omit (null) to seed the "incomplete"
  // pro whose derived operational status is not-ready.
  whatsapp: string | null
  unitIds: string[]
  catalogServiceIds: string[]
  defaultCommission?: CommissionRule | null
  taxIdentity?: TaxIdentity | null
  invitedBy: string
  now: string
}

// Persists the global `users/{uid}` identity (PII: displayName/whatsapp), then
// runs the membership+professional cascade, then the PII sidecar + currentOrgId
// patch — mirroring the production accept-invite ordering. Returns the new
// professional id.
export async function seedProfessional(input: SeedProfessionalInput): Promise<string> {
  // 1. Global user identity (PII lives here, never in the event payload).
  await putUser(
    buildUser(input.userId, input.now, {
      displayName: input.displayName,
      completionCompleted: input.whatsapp !== null,
      whatsapp: input.whatsapp,
      currentOrgId: input.orgId,
    }),
  )

  const proId = input.professionalId ?? newId()
  const membership = buildMembership(input.orgId, input.userId, input.now, {
    role: 'professional',
    invitedBy: input.invitedBy,
  })
  const professional: StoredProfessional = {
    id: proId,
    orgId: input.orgId,
    userId: input.userId,
    defaultCommission: input.defaultCommission ?? null,
    unitIds: input.unitIds,
    catalogServiceIds: input.catalogServiceIds,
    createdAt: input.now,
    updatedAt: input.now,
  }

  // 2. ACID cascade: membership + professional in one transaction.
  const membershipStep: SagaStep = (tx) =>
    appendEventToTx(
      MembershipConfig,
      aggregateRef(MembershipConfig, input.orgId, membershipDocId(input.orgId, input.userId)),
      { _tag: 'membership.created', actorId: input.invitedBy, payload: { data: membership } },
      tx,
    )
  const professionalStep: SagaStep = (tx) =>
    appendEventToTx(
      ProfessionalConfig,
      aggregateRef(ProfessionalConfig, input.orgId, proId),
      { _tag: 'professional.created', actorId: input.invitedBy, payload: { data: professional } },
      tx,
    )

  const outcome = await commitSaga([membershipStep, professionalStep])
  if (!outcome.ok) {
    throw new Error(`seedProfessional cascade failed for ${input.userId}: ${outcome.error}`)
  }

  // 3. Post-commit, non-aggregate writes (idempotent): PII sidecar + currentOrg.
  await upsertProfessionalPii({
    orgId: input.orgId,
    id: proId,
    taxIdentity: input.taxIdentity ?? null,
  })
  await patchUser(input.userId, { current_org_id: input.orgId }, input.now)

  return proId
}
