// Server-side reads that hydrate MemberOperation docs with identity + the
// per-org operational PII so the UI consumes a single `MemberOperation` shape
// and does not have to know about the projection/PII split. The immutable
// event payload + projection carry NO PII (ADR 0010 — direito à eliminação /
// LGPD). Two PII sources are merged at read time:
//
//   1. Personal identity (name/mobile/email) — read LIVE from the global
//      `users/{userId}` doc (#1046 / brief 0028 AC-04/AC-05). This is a
//      reference, not a stored copy: editing the User reflects on the
//      memberOperation with no re-write. The email is the verified OAuth/invite
//      email; mobile comes from the completion step (#838).
//   2. MemberOperation-specific PII (`taxIdentity`) — lives in the per-org
//      deletable doc `member_operations_pii/{id}`. It can diverge from personal
//      identity (e.g. MEI CNPJ) so it stays memberOperation-scoped.
//
// LGPD per-org severability (brief 0032 / #1063): identity is a live
// reference to the global User. Per-org anonymization severs the link
// (and falls back to neutral text via `emptyEnrichment`) WITHOUT touching the
// global User — this read path tolerates a missing/severed User by design.
// Mirrors `customer-read.ts` (the reference identity-merge pattern, #832/#836).

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

// What we actually persist under `orgs/{t}/memberOperations/{id}` (the
// event projection) + the deletable PII doc at `member_operations_pii/{id}`
// (`MemberOperationPii`, holding ONLY `taxIdentity` after #1046 —
// name/mobile/email live on the global User, read live). Both re-exported
// from `@/domain` (read-model source-of-truth) so existing importers keep
// resolving them from here.
export type { MemberOperationPii, StoredMemberOperation } from '@/domain'

function emptyEnrichment(
  p: StoredMemberOperation,
  pii: MemberOperationPii | undefined,
): MemberOperation {
  // The linked User went missing (or the per-org link was severed for
  // LGPD — brief 0032). UI degrades gracefully with neutral text instead of
  // crashing; `taxIdentity` (memberOperation-scoped) still merges if present.
  // No mobile ⇒ never operational (the derive floors at `incomplete`).
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
    // Live identity reference — global User is the source of truth. Anonymized
    // accounts (LGPD #1095, AC-03) resolve to the neutral `Profissional ‹CODE›`.
    //
    // The CUSTOMER per-org block (#1096/#1100) is deliberately NOT applied
    // here: the memberOperation/employment relationship is a DIFFERENT relationship
    // (brief 0032 re-scope 04/06). It is retained IDENTIFIABLE (legal retention,
    // art. 16); its severance is the establishment's offboarding (brief 0041 /
    // #1102), not a customer erasure. So a person blocked as a customer in this
    // org still shows their REAL name (+ avatar) on memberOperation surfaces
    // (team, commissions report).
    name: resolveSubjectName(p.userId, user, 'Profissional') ?? '',
    mobile: user.mobile ?? '',
    email: user.email,
    // MemberOperation-specific PII stays per-org (can diverge — MEI CNPJ).
    taxIdentity: pii?.taxIdentity ?? null,
    // DERIVED on read (#1226 AC-02): the projection exists ⇒ invite accepted;
    // operational iff mobile present ∧ ≥1 unit ∧ ≥1 service.
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

// Hydrate a batch of MemberOperation docs: identity from the global `users` table
// (live) + `taxIdentity` from `member_operations_pii/`, in two batched round-trips.
// Order is preserved.
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

// List all memberOperations for a org, enriched with PII and sorted by name
// in JS (the `name` field doesn't live on the projection row, so the sort
// happens after enrich).
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

// The memberOperations who may appear on operational surfaces (the agenda grid) —
// those that are BOTH operational (ready to take bookings) AND backed by a
// CURRENTLY active membership carrying the `canBeBooked` capability (brief 0076
// AC-03). This is the read-path invariant, now expressed as capability ∧
// readiness instead of the retired `BookableProfessional` brand: "bookable" is
// `canBeBooked` (read from the membership) ∧ operational (mobile ∧ ≥1 unit ∧
// ≥1 service, derived). The `memberOperations` projection alone is not trusted —
// it can outlive a capability toggle — so cross-checking the bookable-member set
// closes the leak WITHOUT deleting any data. Keyed on CURRENT state: toggling
// `canBeBooked` on a member (any role) re-includes them and toggling it off
// drops them, with no special-casing — which is exactly what generalizes the
// model beyond the `memberOperation` role.
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

// The operational memberOperations who perform service Y AND work at unit X —
// enriched + name-sorted, the same shape `listMemberOperationsForOrg` returns. The
// (unit, service) intersection is the inverse query served by the
// `member_operation_units` / `member_operation_services` joins (brief 0068 D3) via their
// (org_id, unit_id) / (org_id, service_id) indexes, replacing the public
// availability path's fetch-all + `memberOperationsForService` filter in JS. Only
// the matching projection rows are loaded, then enriched. Filtering to a single
// memberOperation (the availability `?memberOperation=` filter) stays a caller concern.
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
  // The joins already prove ≥1 unit and ≥1 service for this pro; the operational
  // gate is now DERIVED on read (#1226 AC-02) and adds the mobile-present
  // requirement (PII, only available after enrich), so filter post-enrich.
  return enriched
    .filter((p) => p.operationalStatus === 'operational')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

// The `{ userId, operationalStatus }` pairs for an org's memberOperations — the
// operational-status lookup the team page needs. `operationalStatus` is now
// DERIVED on read (#1226 AC-02) from mobile (PII, on the global User) + the
// projection's units/services, so this MUST enrich (the value is no longer a
// stored column). Reuses `listMemberOperationsForOrg` (enriched + name-sorted) and
// projects down to the `{ userId, operationalStatus }` pairs the team page needs.
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

// Resolve ONLY a memberOperation's `userId`, backend-aware — for guards that just
// need the linked subject (e.g. the offboarding/delete reference check).
// Deliberately tolerant: it does NOT strict-decode the full `StoredMemberOperation`
// nor enrich identity, so a degenerate/legacy projection doc still resolves its
// `userId` instead of throwing a ParseError on a fail-safe guard path. Returns
// null when the memberOperation doesn't exist or carries no linked user.
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

// Resolve the operational MemberOperation projection for a member by their
// `userId` (brief 0037 #1085). A MemberOperation is the projection of a
// `Membership(role=memberOperation)` + `User`, born from the invite saga with a
// non-null `userId` (brief 0028 #1045) — so the member detail looks the
// projection up by the membership's `userId`, not by the projection id (which
// is random). Returns null when no projection exists yet (e.g. a member just
// promoted to memberOperation before role-edit lifecycle materializes it, #1086).
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

/**
 * The memberOperation-id to scope an own-only RLS read/write to (brief 0075,
 * #1256), or `''` for the balcão (owner/manager/recepção), whose reads/writes
 * stay org/unit-wide. A self-scoped member resolves to THEIR own
 * `memberOperations.id` — the value passed as `app.current_member_operation` so the
 * database admits only their rows. Resolved lazily (a DB lookup) only for a
 * self-scoped member; the balcão short-circuits to `''` with no extra query.
 *
 * Gated by CAPABILITY, not by the `role` label (#1269): own-scope clamps whenever
 * the member does NOT operate the front desk (`operatesFrontDesk` = owner/manager
 * by role ∨ `canManageCustomers`). The rest of the capability model
 * (`operatesFrontDesk`, `listBookableMemberUserIds`, nav gating) keys on
 * capability too, so a custom preset that separates role from capability (exactly
 * what ADR 0014 enables) can't drift the two axes — a bookable member who lacks
 * `canManageCustomers` and whose role isn't literally `member_operator` is still
 * clamped to their own scope, not widened to the whole unit.
 *
 * Fail-closed: a self-scoped member whose projection row is missing (incomplete
 * onboarding, or projection lag post invite-accept) must NOT widen to `''` (which
 * would be permissive) — it returns {@link NO_MEMBER_OPERATION_SCOPE}, a sentinel
 * that matches no row. The capability is the gate; the projection only supplies
 * the id. Callers detect the sentinel to surface an explicit degraded state (the
 * agenda's empty-state, #1268) instead of a mute empty grid.
 */
export async function resolveMemberOperationScope(membership: Membership): Promise<string> {
  if (operatesFrontDesk(membership)) return ''
  const memberOperation = await getMemberOperationByUserId(membership.orgId, membership.userId)
  return memberOperation?.id ?? NO_MEMBER_OPERATION_SCOPE
}

/**
 * The acting member's own-scope RLS payload for a WRITE (brief 0075, #1265),
 * matching `effect-bridge`'s `WriteSecurity` shape (typed structurally here to
 * avoid a dependency on the bridge). `undefined` for the balcão (no own-scope →
 * the GUC stays permissive); otherwise carries the resolved scope id so the
 * own-scope WITH CHECK refuses writing a colleague's row AT THE DATABASE — the
 * last line of defense behind the application gate.
 *
 * The single resolver for every own-scope write call-site (agenda actions, the
 * close-order saga, …) so the scope→security mapping (including the fail-closed
 * sentinel, which is forwarded verbatim and matches no row) lives in one place
 * and can't drift per consumer.
 */
export async function resolveWriteSecurity(
  membership: Membership,
  unitId: string,
): Promise<{ orgId: string; unitId: string | null; memberOperationId: string } | undefined> {
  const ownScope = await resolveMemberOperationScope(membership)
  if (ownScope === '') return undefined
  return { orgId: membership.orgId, unitId, memberOperationId: ownScope }
}

/**
 * Fail-closed sentinel scope (brief 0075, #1268): a self-scoped member whose
 * `member_operations` projection isn't there yet resolves to this. It matches no
 * `member_operation_id` in any RLS predicate / column filter, so the member's
 * reads return EMPTY rather than widening to the unit — never a colleague leak.
 * A magic string would re-appear in every consumer + test; this is the single
 * contract both `resolveMemberOperationScope` and its callers compare against.
 */
export const NO_MEMBER_OPERATION_SCOPE = '__no_member_operation__'

// Write the per-org PII row directly (mutable, deletable, NOT event-sourced).
// After #1046 it holds only `taxIdentity` — personal identity is a live reference
// to the global User. Called from the update action alongside the domain event
// emission. Backed by the typed `member_operations_pii` table (org RLS).
export async function writeMemberOperationPii(
  orgId: string,
  memberOperationId: string,
  pii: MemberOperationPii,
): Promise<void> {
  await upsertMemberOperationPii({ orgId, id: memberOperationId, taxIdentity: pii.taxIdentity })
}

// Delete the PII row (LGPD erasure) — called when the memberOperation is deleted.
export async function deleteMemberOperationPii(
  orgId: string,
  memberOperationId: string,
): Promise<void> {
  await deleteMemberOperationPiiRow(orgId, memberOperationId)
}

// How many memberOperations are scoped to a unit — for the unit delete-guard, which
// only needs existence (count > 0), not the decoded objects. Deliberately
// tolerant: it does NOT strict-decode/enrich, so a degenerate projection row
// still counts instead of throwing on a fail-safe guard.
export async function countMemberOperationsWithUnit(
  orgId: string,
  unitId: string,
): Promise<number> {
  // The inverse query "memberOperations at unit X" — served by the
  // `member_operation_units` join table (brief 0068 D3) via its (org_id, unit_id)
  // index, replacing the JSONB `unit_ids @>` containment scan.
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

// "Is there an operational memberOperation at unit X?" — the per-unit publish
// readiness check (brief 0008 #988). `operationalStatus` is DERIVED on read
// (#1226 AC-02) from mobile (PII on the global User) + the projection's
// units/services, so this can no longer be a pure SQL predicate. The SQL narrows
// to the candidates — memberOperations at this unit (`member_operation_units` join, its
// (org_id, unit_id) index) that ALSO perform ≥1 service (`member_operation_services`
// EXISTS) — then the rows are enriched and the readiness derived; `.some`
// short-circuits.
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

// The ids of memberOperations who already perform service Y — the inverse query
// served by the `member_operation_services` join (brief 0068 D3) via its (org_id,
// service_id) index, replacing the fetch-all + `.includes()` over
// `catalog_service_ids` in JS. Used to compute the toggle diff in
// `setServiceMemberOperations` without scanning every memberOperation.
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
