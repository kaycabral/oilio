// global User — this read path tolerates a missing/severed User by design.

import {
  isOperational,
  resolveSubjectName,
  StoredMemberOperation,
  type MemberOperation,
  type MemberOperationPii,
  type Membership,
  type OperationalStatus,
  type User,
} from '@/domain'
import { deriveOperationalStatus } from '@/domain/aggregates'
import { rowToDoc, type MemberOperationRow } from '@/shared/db/pg/effect/member-operation-projector'
import {
  deleteMemberOperationPii as deleteMemberOperationPiiRow,
  getMemberOperationPiiByIds,
  upsertMemberOperationPii,
} from '@/shared/db/pg/pii-sidecars-store'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getUsersByIds } from '@/shared/db/pg/users-store'
import { listBookableMemberUserIds, operatesFrontDesk } from '@/shared/org/membership'
import { Schema } from 'effect'

const decodeStoredMemberOperation = Schema.decodeUnknownSync(StoredMemberOperation)

export type { MemberOperationPii, StoredMemberOperation } from '@/domain'

function emptyEnrichment(
  p: StoredMemberOperation,
  pii: MemberOperationPii | undefined,
): MemberOperation {
  return {
    ...p,
    name: '(profissional sem dados)',
    mobile: '',
    email: null,
    taxIdentity: pii?.taxIdentity ?? null,
    operationalStatus: deriveOperationalStatus({
      inviteAccepted: true,
      mobile: '',
      unitIds: p.unitIds,
      catalogServiceIds: p.catalogServiceIds,
    }),
  }
}

function mergeIdentity(
  p: StoredMemberOperation,
  user: User | undefined,
  pii: MemberOperationPii | undefined,
): MemberOperation {
  if (!user) return emptyEnrichment(p, pii)
  return {
    ...p,
    name: resolveSubjectName(p.userId, user, 'Profissional') ?? '',
    mobile: user.mobile ?? '',
    email: user.email,
    taxIdentity: pii?.taxIdentity ?? null,
    operationalStatus: deriveOperationalStatus({
      inviteAccepted: true,
      mobile: user.mobile,
      unitIds: p.unitIds,
      catalogServiceIds: p.catalogServiceIds,
    }),
  }
}

async function fetchPiiByIds(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, MemberOperationPii>> {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))]
  return getMemberOperationPiiByIds(orgId, unique)
}

export async function enrichMemberOperations(
  orgId: string,
  memberOperations: readonly StoredMemberOperation[],
): Promise<MemberOperation[]> {
  if (memberOperations.length === 0) return []
  const [pii, users] = await Promise.all([
    fetchPiiByIds(
      orgId,
      memberOperations.map((p) => p.id),
    ),
    getUsersByIds(memberOperations.map((p) => p.userId)),
  ])
  return memberOperations.map((p) => mergeIdentity(p, users.get(p.userId), pii.get(p.id)))
}

export async function listMemberOperationsForOrg(orgId: string): Promise<MemberOperation[]> {
  const rows = await readUnderRls<MemberOperationRow>(orgId, (client) =>
    client
      .query<MemberOperationRow>('SELECT * FROM member_operations WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  const stored = rows.map((r) => decodeStoredMemberOperation(rowToDoc(r)))
  const enriched = await enrichMemberOperations(orgId, stored)
  return enriched.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

export async function listBookableMemberOperationsForOrg(
  orgId: string,
): Promise<MemberOperation[]> {
  const [memberOperations, bookableMemberUserIds] = await Promise.all([
    listMemberOperationsForOrg(orgId),
    listBookableMemberUserIds(orgId),
  ])
  return memberOperations.filter(
    (p) => isOperational(p.operationalStatus) && bookableMemberUserIds.has(p.userId),
  )
}

export async function listMemberOperationsForServiceInUnit(
  orgId: string,
  serviceId: string,
  unitId: string,
): Promise<MemberOperation[]> {
  const rows = await readUnderRls<MemberOperationRow>(orgId, (client) =>
    client
      .query<MemberOperationRow>(
        `SELECT p.* FROM member_operations p
         JOIN member_operation_units pu ON pu.org_id = p.org_id AND pu.member_operation_id = p.id
         JOIN member_operation_services ps ON ps.org_id = p.org_id AND ps.member_operation_id = p.id
         WHERE p.org_id = $1 AND pu.unit_id = $2 AND ps.service_id = $3`,
        [orgId, unitId, serviceId],
      )
      .then((res) => res.rows),
  )
  const stored = rows.map((r) => decodeStoredMemberOperation(rowToDoc(r)))
  const enriched = await enrichMemberOperations(orgId, stored)
  return enriched
    .filter((p) => p.operationalStatus === 'operational')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

export async function listMemberOperationStatuses(
  orgId: string,
): Promise<{ userId: string; operationalStatus: OperationalStatus }[]> {
  const memberOperations = await listMemberOperationsForOrg(orgId)
  return memberOperations.map((p) => ({
    userId: p.userId,
    operationalStatus: p.operationalStatus,
  }))
}

export async function getMemberOperationById(
  orgId: string,
  memberOperationId: string,
): Promise<MemberOperation | null> {
  const rows = await readUnderRls<MemberOperationRow>(orgId, (client) =>
    client
      .query<MemberOperationRow>('SELECT * FROM member_operations WHERE org_id = $1 AND id = $2', [
        orgId,
        memberOperationId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  if (!row) return null
  const [enriched] = await enrichMemberOperations(orgId, [
    decodeStoredMemberOperation(rowToDoc(row)),
  ])
  return enriched ?? null
}

export async function getMemberOperationUserId(
  orgId: string,
  memberOperationId: string,
): Promise<string | null> {
  const rows = await readUnderRls<{ user_id: string | null }>(orgId, (client) =>
    client
      .query<{
        user_id: string | null
      }>('SELECT user_id FROM member_operations WHERE org_id = $1 AND id = $2', [
        orgId,
        memberOperationId,
      ])
      .then((res) => res.rows),
  )
  return rows[0]?.user_id ?? null
}

export async function getMemberOperationByUserId(
  orgId: string,
  userId: string,
): Promise<MemberOperation | null> {
  const rows = await readUnderRls<MemberOperationRow>(orgId, (client) =>
    client
      .query<MemberOperationRow>(
        'SELECT * FROM member_operations WHERE org_id = $1 AND user_id = $2 LIMIT 1',
        [orgId, userId],
      )
      .then((res) => res.rows),
  )
  const row = rows[0]
  if (!row) return null
  const [enriched] = await enrichMemberOperations(orgId, [
    decodeStoredMemberOperation(rowToDoc(row)),
  ])
  return enriched ?? null
}

export async function resolveMemberOperationScope(membership: Membership): Promise<string> {
  if (operatesFrontDesk(membership)) return ''
  const memberOperation = await getMemberOperationByUserId(membership.orgId, membership.userId)
  return memberOperation?.id ?? NO_MEMBER_OPERATION_SCOPE
}

export async function resolveWriteSecurity(
  membership: Membership,
  unitId: string,
): Promise<{ orgId: string; unitId: string | null; memberOperationId: string } | undefined> {
  const ownScope = await resolveMemberOperationScope(membership)
  if (ownScope === '') return undefined
  return { orgId: membership.orgId, unitId, memberOperationId: ownScope }
}

export const NO_MEMBER_OPERATION_SCOPE = '__no_member_operation__'

export async function writeMemberOperationPii(
  orgId: string,
  memberOperationId: string,
  pii: MemberOperationPii,
): Promise<void> {
  await upsertMemberOperationPii({ orgId, id: memberOperationId, taxIdentity: pii.taxIdentity })
}

export async function deleteMemberOperationPii(
  orgId: string,
  memberOperationId: string,
): Promise<void> {
  await deleteMemberOperationPiiRow(orgId, memberOperationId)
}

export async function countMemberOperationsWithUnit(
  orgId: string,
  unitId: string,
): Promise<number> {
  const rows = await readUnderRls<{ n: string | number }>(orgId, (client) =>
    client
      .query<{
        n: string | number
      }>('SELECT count(*) AS n FROM member_operation_units WHERE org_id = $1 AND unit_id = $2', [
        orgId,
        unitId,
      ])
      .then((res) => res.rows),
  )
  return Number(rows[0]?.n ?? 0)
}

export async function hasOperationalMemberOperationInUnit(
  orgId: string,
  unitId: string,
): Promise<boolean> {
  const rows = await readUnderRls<MemberOperationRow>(orgId, (client) =>
    client
      .query<MemberOperationRow>(
        `SELECT p.* FROM member_operation_units pu
         JOIN member_operations p ON p.org_id = pu.org_id AND p.id = pu.member_operation_id
         WHERE pu.org_id = $1 AND pu.unit_id = $2
           AND EXISTS (
             SELECT 1 FROM member_operation_services ps
             WHERE ps.org_id = p.org_id AND ps.member_operation_id = p.id
           )`,
        [orgId, unitId],
      )
      .then((res) => res.rows),
  )
  if (rows.length === 0) return false
  const stored = rows.map((r) => decodeStoredMemberOperation(rowToDoc(r)))
  const enriched = await enrichMemberOperations(orgId, stored)
  return enriched.some((p) => p.operationalStatus === 'operational')
}

export async function listMemberOperationIdsForService(
  orgId: string,
  serviceId: string,
): Promise<string[]> {
  const rows = await readUnderRls<{ member_operation_id: string }>(orgId, (client) =>
    client
      .query<{
        member_operation_id: string
      }>(
        'SELECT member_operation_id FROM member_operation_services WHERE org_id = $1 AND service_id = $2',
        [orgId, serviceId],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => r.member_operation_id)
}
