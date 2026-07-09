import { isCatalogService, type MemberOperation, type StoredMemberOperation } from '@/domain'
import type { EventInput } from '@/domain/effect'

import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { newId } from '@/shared/db/pg/new-id'

import { getMemberOperationByUserId } from '@/shared/org/member-operation-read'

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
