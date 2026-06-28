// Internal write/saga helpers for the team member actions — extracted from the
// 'use server' module to stay under the module-size gate. Not server actions
// (never form-invoked); imperative-shell helpers the actions compose. All
// return `string | null` (error | success), so no result-type cycle.

import { isCatalogService, type MemberOperation, type StoredMemberOperation } from '@/domain'
import type { EventInput } from '@/domain/effect'

import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { newId } from '@/shared/db/pg/new-id'

import { getMemberOperationByUserId } from '@/shared/org/member-operation-read'

// Identity (name/whatsapp/email) is NOT parsed here (#1046 / brief 0028
// AC-04/AC-05): it derives live from `users/{userId}`. The operational edit
// form only carries memberOperation-scoped fields + `taxIdentity`.
// `operationalStatus` is NOT parsed nor stored (#1226 AC-02): it is DERIVED on
// read from real facts (whatsapp present ∧ ≥1 unit ∧ ≥1 service), never written.
// Validates the #876 invariant: every `serviceId` in the pro's list must
// belong to a service whose `unitIds` intersects the pro's `unitIds`. A
// service the pro doesn't share any unit with would be unreachable on the
// agenda — reject before the write. Returns null on success, an error
// message on the first invalid serviceId. Reads the unified catalog (brief
// 0023, #1004): catalogServiceIds are FKs into `catalog_items` of kind service.
export async function validateServiceUnitIntersection(
  orgId: string,
  catalogServiceIds: string[],
  proUnitIds: string[],
): Promise<string | null> {
  if (catalogServiceIds.length === 0) return null
  const proUnitSet = new Set(proUnitIds)
  for (const sid of catalogServiceIds) {
    const item = await getCatalogItemById(orgId, sid)
    if (!item) return `Serviço ${sid} não encontrado`
    if (!isCatalogService(item)) return `Item ${sid} não é um serviço`
    const sharedUnit = (item.unitIds ?? []).some((u) => proUnitSet.has(u))
    if (!sharedUnit) {
      return `Serviço "${item.name}" não compartilha nenhuma unidade com o profissional.`
    }
  }
  return null
}

// The memberOperation-projection decision for a role change, RESOLVED from reads but
// not yet emitted — so the Postgres ACID path (#1199) can run it as a saga step
// inside the membership tx, then do the PII sidecar post-commit.
//
// Since `operationalStatus` is DERIVED on read (#1226 AC-02), a role change no
// longer emits `member_operation.activated`/`.suspended` — re-promotion and demotion
// need no projection event (a re-promoted pro's readiness is recomputed from
// real facts on the next read; a demoted member's projection is severed by the
// offboarding flow, brief 0041). The only remaining write is MATERIALIZING a new
// projection on first promotion:
//   - `none`   — no projection to create (no existing on demotion, or already
//                exists on re-promotion).
//   - `create` — materialize a NEW projection (promotion, no existing) + a
//                post-commit `member_operations_pii` sidecar.
export type MemberOperatorRoleStep =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'create'
      readonly path: string
      readonly proId: string
      readonly input: EventInput<'member_operation.created'>
    }

export async function resolveMemberOperatorRoleStep(args: {
  orgId: string
  actorId: string
  targetUserId: string
  willBeMemberOperator: boolean
}): Promise<MemberOperatorRoleStep> {
  const { orgId, actorId, targetUserId, willBeMemberOperator } = args
  if (!willBeMemberOperator) return { kind: 'none' }

  // ≤1 projection per userId per org: re-promotion of an existing projection is a
  // no-op (readiness is derived on read), so only materialize when absent.
  const existingPro: MemberOperation | null = await getMemberOperationByUserId(orgId, targetUserId)
  if (existingPro) return { kind: 'none' }

  const now = new Date().toISOString()
  const proId = newId()
  const stored: StoredMemberOperation = {
    id: proId,
    orgId,
    userId: targetUserId,
    defaultCommission: null,
    unitIds: [],
    catalogServiceIds: [],
    createdAt: now,
    updatedAt: now,
  }
  return {
    kind: 'create',
    path: `orgs/${orgId}/memberOperations/${proId}`,
    proId,
    input: { _tag: 'member_operation.created', actorId, payload: { data: stored } },
  }
}
