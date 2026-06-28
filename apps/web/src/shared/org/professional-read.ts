// Server-side reads that hydrate Professional docs with identity + the
// per-org operational PII so the UI consumes a single `Professional` shape
// and does not have to know about the projection/PII split. The immutable
// event payload + projection carry NO PII (ADR 0010 — direito à eliminação /
// LGPD). Two PII sources are merged at read time:
//
//   1. Personal identity (name/whatsapp/email) — read LIVE from the global
//      `users/{userId}` doc (#1046 / brief 0028 AC-04/AC-05). This is a
//      reference, not a stored copy: editing the User reflects on the
//      professional with no re-write. The email is the verified OAuth/invite
//      email; whatsapp comes from the completion step (#838).
//   2. Professional-specific PII (`taxIdentity`) — lives in the per-org
//      deletable doc `professionals_pii/{id}`. It can diverge from personal
//      identity (e.g. MEI CNPJ) so it stays professional-scoped.
//
// LGPD per-org severability (brief 0032 / #1063): identity is a live
// reference to the global User. Per-org anonymization severs the link
// (and falls back to neutral text via `emptyEnrichment`) WITHOUT touching the
// global User — this read path tolerates a missing/severed User by design.
// Mirrors `customer-read.ts` (the reference identity-merge pattern, #832/#836).

import {
  isOperational,
  resolveSubjectName,
  StoredProfessional,
  type BookableProfessional,
  type Membership,
  type OperationalStatus,
  type Professional,
  type ProfessionalPii,
  type User,
} from '@/domain'
import { deriveOperationalStatus } from '@/domain/aggregates'
import { rowToDoc, type ProfessionalRow } from '@/shared/db/pg/effect/professional-projector'
import {
  deleteProfessionalPii as deleteProfessionalPiiRow,
  getProfessionalPiiByIds,
  upsertProfessionalPii,
} from '@/shared/db/pg/pii-sidecars-store'
import { readUnderRls } from '@/shared/db/pg/rls-read'
import { getUsersByIds } from '@/shared/db/pg/users-store'
import { listActiveProfessionalUserIds } from '@/shared/org/membership'
import { Schema } from 'effect'

const decodeStoredProfessional = Schema.decodeUnknownSync(StoredProfessional)

// What we actually persist under `orgs/{t}/professionals/{id}` (the
// event projection) + the deletable PII doc at `professionals_pii/{id}`
// (`ProfessionalPii`, holding ONLY `taxIdentity` after #1046 —
// name/whatsapp/email live on the global User, read live). Both re-exported
// from `@/domain` (read-model source-of-truth) so existing importers keep
// resolving them from here.
export type { ProfessionalPii, StoredProfessional } from '@/domain'

function emptyEnrichment(p: StoredProfessional, pii: ProfessionalPii | undefined): Professional {
  // The linked User went missing (or the per-org link was severed for
  // LGPD — brief 0032). UI degrades gracefully with neutral text instead of
  // crashing; `taxIdentity` (professional-scoped) still merges if present.
  // No whatsapp ⇒ never operational (the derive floors at `incomplete`).
  return {
    ...p,
    name: '(profissional sem dados)',
    whatsapp: '',
    email: null,
    taxIdentity: pii?.taxIdentity ?? null,
    operationalStatus: deriveOperationalStatus({
      inviteAccepted: true,
      whatsapp: '',
      unitIds: p.unitIds,
      catalogServiceIds: p.catalogServiceIds,
    }),
  }
}

function mergeIdentity(
  p: StoredProfessional,
  user: User | undefined,
  pii: ProfessionalPii | undefined,
): Professional {
  if (!user) return emptyEnrichment(p, pii)
  return {
    ...p,
    // Live identity reference — global User is the source of truth. Anonymized
    // accounts (LGPD #1095, AC-03) resolve to the neutral `Profissional ‹CODE›`.
    //
    // The CUSTOMER per-org block (#1096/#1100) is deliberately NOT applied
    // here: the professional/employment relationship is a DIFFERENT relationship
    // (brief 0032 re-scope 04/06). It is retained IDENTIFIABLE (legal retention,
    // art. 16); its severance is the establishment's offboarding (brief 0041 /
    // #1102), not a customer erasure. So a person blocked as a customer in this
    // org still shows their REAL name (+ avatar) on professional surfaces
    // (team, commissions report).
    name: resolveSubjectName(p.userId, user, 'Profissional') ?? '',
    whatsapp: user.whatsapp ?? '',
    email: user.email,
    // Professional-specific PII stays per-org (can diverge — MEI CNPJ).
    taxIdentity: pii?.taxIdentity ?? null,
    // DERIVED on read (#1226 AC-02): the projection exists ⇒ invite accepted;
    // operational iff whatsapp present ∧ ≥1 unit ∧ ≥1 service.
    operationalStatus: deriveOperationalStatus({
      inviteAccepted: true,
      whatsapp: user.whatsapp,
      unitIds: p.unitIds,
      catalogServiceIds: p.catalogServiceIds,
    }),
  }
}

async function fetchPiiByIds(
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, ProfessionalPii>> {
  const unique = [...new Set(ids.filter((id) => Boolean(id)))]
  return getProfessionalPiiByIds(orgId, unique)
}

// Hydrate a batch of Professional docs: identity from the global `users` table
// (live) + `taxIdentity` from `professionals_pii/`, in two batched round-trips.
// Order is preserved.
export async function enrichProfessionals(
  orgId: string,
  professionals: readonly StoredProfessional[],
): Promise<Professional[]> {
  if (professionals.length === 0) return []
  const [pii, users] = await Promise.all([
    fetchPiiByIds(
      orgId,
      professionals.map((p) => p.id),
    ),
    getUsersByIds(professionals.map((p) => p.userId)),
  ])
  return professionals.map((p) => mergeIdentity(p, users.get(p.userId), pii.get(p.id)))
}

// List all professionals for a org, enriched with PII and sorted by name
// in JS (the `name` field doesn't live on the projection row, so the sort
// happens after enrich).
export async function listProfessionalsForOrg(orgId: string): Promise<Professional[]> {
  const rows = await readUnderRls<ProfessionalRow>(orgId, (client) =>
    client
      .query<ProfessionalRow>('SELECT * FROM professionals WHERE org_id = $1', [orgId])
      .then((res) => res.rows),
  )
  const stored = rows.map((r) => decodeStoredProfessional(rowToDoc(r)))
  const enriched = await enrichProfessionals(orgId, stored)
  return enriched.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

// The professionals who may appear on operational surfaces (the agenda grid) —
// those that are BOTH operational (ready to take bookings) AND backed by a
// CURRENTLY active membership with role `professional`. This is the read-path
// invariant: the `professionals` projection alone is not trusted, because it can
// outlive the role (a demoted member keeps a row for reversibility — see
// role-edit-lifecycle) or be wrongly materialized (a seed/migration inserting a
// row for a non-professional). Cross-checking the active-professional user set
// closes both leaks WITHOUT deleting any data. Returns the `BookableProfessional`
// brand so callers (the agenda) can't be handed the raw `listProfessionalsForOrg`
// result by mistake. Keyed on current state, so a promotion re-includes the user
// and a demotion drops them with no special-casing.
export async function listBookableProfessionalsForOrg(
  orgId: string,
): Promise<BookableProfessional[]> {
  const [professionals, activeProUserIds] = await Promise.all([
    listProfessionalsForOrg(orgId),
    listActiveProfessionalUserIds(orgId),
  ])
  return professionals.filter(
    (p): p is BookableProfessional =>
      isOperational(p.operationalStatus) && activeProUserIds.has(p.userId),
  )
}

// The operational professionals who perform service Y AND work at unit X —
// enriched + name-sorted, the same shape `listProfessionalsForOrg` returns. The
// (unit, service) intersection is the inverse query served by the
// `professional_units` / `professional_services` joins (brief 0068 D3) via their
// (org_id, unit_id) / (org_id, service_id) indexes, replacing the public
// availability path's fetch-all + `professionalsForService` filter in JS. Only
// the matching projection rows are loaded, then enriched. Filtering to a single
// professional (the availability `?professional=` filter) stays a caller concern.
export async function listProfessionalsForServiceInUnit(
  orgId: string,
  serviceId: string,
  unitId: string,
): Promise<Professional[]> {
  const rows = await readUnderRls<ProfessionalRow>(orgId, (client) =>
    client
      .query<ProfessionalRow>(
        `SELECT p.* FROM professionals p
         JOIN professional_units pu ON pu.org_id = p.org_id AND pu.professional_id = p.id
         JOIN professional_services ps ON ps.org_id = p.org_id AND ps.professional_id = p.id
         WHERE p.org_id = $1 AND pu.unit_id = $2 AND ps.service_id = $3`,
        [orgId, unitId, serviceId],
      )
      .then((res) => res.rows),
  )
  const stored = rows.map((r) => decodeStoredProfessional(rowToDoc(r)))
  const enriched = await enrichProfessionals(orgId, stored)
  // The joins already prove ≥1 unit and ≥1 service for this pro; the operational
  // gate is now DERIVED on read (#1226 AC-02) and adds the whatsapp-present
  // requirement (PII, only available after enrich), so filter post-enrich.
  return enriched
    .filter((p) => p.operationalStatus === 'operational')
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

// The `{ userId, operationalStatus }` pairs for an org's professionals — the
// operational-status lookup the team page needs. `operationalStatus` is now
// DERIVED on read (#1226 AC-02) from whatsapp (PII, on the global User) + the
// projection's units/services, so this MUST enrich (the value is no longer a
// stored column). Reuses `listProfessionalsForOrg` (enriched + name-sorted) and
// projects down to the `{ userId, operationalStatus }` pairs the team page needs.
export async function listProfessionalStatuses(
  orgId: string,
): Promise<{ userId: string; operationalStatus: OperationalStatus }[]> {
  const professionals = await listProfessionalsForOrg(orgId)
  return professionals.map((p) => ({
    userId: p.userId,
    operationalStatus: p.operationalStatus,
  }))
}

export async function getProfessionalById(
  orgId: string,
  professionalId: string,
): Promise<Professional | null> {
  const rows = await readUnderRls<ProfessionalRow>(orgId, (client) =>
    client
      .query<ProfessionalRow>('SELECT * FROM professionals WHERE org_id = $1 AND id = $2', [
        orgId,
        professionalId,
      ])
      .then((res) => res.rows),
  )
  const row = rows[0]
  if (!row) return null
  const [enriched] = await enrichProfessionals(orgId, [decodeStoredProfessional(rowToDoc(row))])
  return enriched ?? null
}

// Resolve ONLY a professional's `userId`, backend-aware — for guards that just
// need the linked subject (e.g. the offboarding/delete reference check).
// Deliberately tolerant: it does NOT strict-decode the full `StoredProfessional`
// nor enrich identity, so a degenerate/legacy projection doc still resolves its
// `userId` instead of throwing a ParseError on a fail-safe guard path. Returns
// null when the professional doesn't exist or carries no linked user.
export async function getProfessionalUserId(
  orgId: string,
  professionalId: string,
): Promise<string | null> {
  const rows = await readUnderRls<{ user_id: string | null }>(orgId, (client) =>
    client
      .query<{
        user_id: string | null
      }>('SELECT user_id FROM professionals WHERE org_id = $1 AND id = $2', [orgId, professionalId])
      .then((res) => res.rows),
  )
  return rows[0]?.user_id ?? null
}

// Resolve the operational Professional projection for a member by their
// `userId` (brief 0037 #1085). A Professional is the projection of a
// `Membership(role=professional)` + `User`, born from the invite saga with a
// non-null `userId` (brief 0028 #1045) — so the member detail looks the
// projection up by the membership's `userId`, not by the projection id (which
// is random). Returns null when no projection exists yet (e.g. a member just
// promoted to professional before role-edit lifecycle materializes it, #1086).
export async function getProfessionalByUserId(
  orgId: string,
  userId: string,
): Promise<Professional | null> {
  const rows = await readUnderRls<ProfessionalRow>(orgId, (client) =>
    client
      .query<ProfessionalRow>(
        'SELECT * FROM professionals WHERE org_id = $1 AND user_id = $2 LIMIT 1',
        [orgId, userId],
      )
      .then((res) => res.rows),
  )
  const row = rows[0]
  if (!row) return null
  const [enriched] = await enrichProfessionals(orgId, [decodeStoredProfessional(rowToDoc(row))])
  return enriched ?? null
}

/**
 * The professional-id to scope an own-only RLS read/write to (brief 0075,
 * #1256), or `''` for the balcão (owner/manager/recepção), whose reads/writes
 * stay org/unit-wide. A self-scoped professional resolves to THEIR own
 * `professionals.id` — the value passed as `app.current_professional` so the
 * database admits only their rows. Resolved lazily (a DB lookup) only for a
 * professional membership; the balcão short-circuits to `''` with no extra query.
 *
 * Fail-closed: a professional whose projection row is missing (incomplete
 * onboarding) must NOT widen to `''` (which would be permissive) — it returns a
 * sentinel that matches no row. The membership role is the gate; the projection
 * only supplies the id.
 */
export async function resolveProfessionalScope(membership: Membership): Promise<string> {
  if (membership.role !== 'professional') return ''
  const professional = await getProfessionalByUserId(membership.orgId, membership.userId)
  return professional?.id ?? '__no_professional__'
}

// Write the per-org PII row directly (mutable, deletable, NOT event-sourced).
// After #1046 it holds only `taxIdentity` — personal identity is a live reference
// to the global User. Called from the update action alongside the domain event
// emission. Backed by the typed `professionals_pii` table (org RLS).
export async function writeProfessionalPii(
  orgId: string,
  professionalId: string,
  pii: ProfessionalPii,
): Promise<void> {
  await upsertProfessionalPii({ orgId, id: professionalId, taxIdentity: pii.taxIdentity })
}

// Delete the PII row (LGPD erasure) — called when the professional is deleted.
export async function deleteProfessionalPii(orgId: string, professionalId: string): Promise<void> {
  await deleteProfessionalPiiRow(orgId, professionalId)
}

// How many professionals are scoped to a unit — for the unit delete-guard, which
// only needs existence (count > 0), not the decoded objects. Deliberately
// tolerant: it does NOT strict-decode/enrich, so a degenerate projection row
// still counts instead of throwing on a fail-safe guard.
export async function countProfessionalsWithUnit(orgId: string, unitId: string): Promise<number> {
  // The inverse query "professionals at unit X" — served by the
  // `professional_units` join table (brief 0068 D3) via its (org_id, unit_id)
  // index, replacing the JSONB `unit_ids @>` containment scan.
  const rows = await readUnderRls<{ n: string | number }>(orgId, (client) =>
    client
      .query<{
        n: string | number
      }>('SELECT count(*) AS n FROM professional_units WHERE org_id = $1 AND unit_id = $2', [
        orgId,
        unitId,
      ])
      .then((res) => res.rows),
  )
  return Number(rows[0]?.n ?? 0)
}

// "Is there an operational professional at unit X?" — the per-unit publish
// readiness check (brief 0008 #988). `operationalStatus` is DERIVED on read
// (#1226 AC-02) from whatsapp (PII on the global User) + the projection's
// units/services, so this can no longer be a pure SQL predicate. The SQL narrows
// to the candidates — professionals at this unit (`professional_units` join, its
// (org_id, unit_id) index) that ALSO perform ≥1 service (`professional_services`
// EXISTS) — then the rows are enriched and the readiness derived; `.some`
// short-circuits.
export async function hasOperationalProfessionalInUnit(
  orgId: string,
  unitId: string,
): Promise<boolean> {
  const rows = await readUnderRls<ProfessionalRow>(orgId, (client) =>
    client
      .query<ProfessionalRow>(
        `SELECT p.* FROM professional_units pu
         JOIN professionals p ON p.org_id = pu.org_id AND p.id = pu.professional_id
         WHERE pu.org_id = $1 AND pu.unit_id = $2
           AND EXISTS (
             SELECT 1 FROM professional_services ps
             WHERE ps.org_id = p.org_id AND ps.professional_id = p.id
           )`,
        [orgId, unitId],
      )
      .then((res) => res.rows),
  )
  if (rows.length === 0) return false
  const stored = rows.map((r) => decodeStoredProfessional(rowToDoc(r)))
  const enriched = await enrichProfessionals(orgId, stored)
  return enriched.some((p) => p.operationalStatus === 'operational')
}

// The ids of professionals who already perform service Y — the inverse query
// served by the `professional_services` join (brief 0068 D3) via its (org_id,
// service_id) index, replacing the fetch-all + `.includes()` over
// `catalog_service_ids` in JS. Used to compute the toggle diff in
// `setServiceProfessionals` without scanning every professional.
export async function listProfessionalIdsForService(
  orgId: string,
  serviceId: string,
): Promise<string[]> {
  const rows = await readUnderRls<{ professional_id: string }>(orgId, (client) =>
    client
      .query<{
        professional_id: string
      }>(
        'SELECT professional_id FROM professional_services WHERE org_id = $1 AND service_id = $2',
        [orgId, serviceId],
      )
      .then((res) => res.rows),
  )
  return rows.map((r) => r.professional_id)
}
