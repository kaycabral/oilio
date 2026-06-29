// Feature-level E2E for brief 0041 (#1102) — team member offboarding, validated
// as a COHESIVE JOURNEY against the brief §DoD. One `test()` per DoD scenario:
//
//   - Cenário 1 — desligamento limpo (happy path): an owner removes a
//     memberOperation who has a future appointment, an agenda-block, a pending
//     invite and a PAST commission, with NO open comanda. The whole cascade runs
//     end-to-end through the UI: membership → `revoked`, projection deactivated,
//     gone from the active team + public booking, future appointment cancelled
//     (retained struck-through), agenda-block cleaned, pending invite cleaned,
//     PII retained (art. 16) — and the past commission STILL shows the member's
//     REAL name in the report (snapshot, identifiable).
//
//   - Cenário 2 — recusa por comanda aberta: a memberOperation with an OPEN comanda
//     is refused removal with a clear message; the saga never starts (membership
//     stays active). A pending COMMISSION does NOT block (AC-06 reescopo —
//     off-system settlement).
//
//   - Cenário 3 — identidade preservada + separada do cliente: the SAME person is
//     a PROFESSIONAL in org A and a CUSTOMER in org B. Removed from A's
//     team, A's commission stays identifiable (real name via snapshot) — and even
//     after the person's GLOBAL account is anonymized as a customer, A's
//     memberOperation commission STILL shows the real name. The customer-erasure
//     side (0032: per-org block via the archived customer shadow) NEVER touches
//     A's memberOperation records. The two relationships never cross.
//
// Cohesive feature journey: Cenário 1 drives the full UI cascade + report; the
// granular per-AC assertions live in the sub-issue specs (member-offboarding for
// #1103/#1104/#1105 and commissions-revoked-identity for #1106). This suite is
// the DoD-level proof + the cross-relationship separation invariant.
//
// Runs against the emulator (auth only — no mocks). Reads projections + event
// streams straight from Postgres (the event store, post-cutover #1202).

import { anonymizedLabel, buildUserAnonymizationScrub, membershipDocId } from '@/domain'
import {
  AgendaBlockConfig,
  AppointmentConfig,
  CommissionConfig,
  InviteConfig,
  MemberOperationConfig,
  MembershipConfig,
} from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { patchUser } from '@/shared/db/pg/users-store'
import { expect, test } from '../fixtures'
import {
  blockedSubjectMarkerExists,
  pgProjectionExists,
  pgReadProjection,
  readMemberOperationByUserId,
  seedAppointment,
  seedBlock,
  seedClosedOrder,
  seedCommission,
  seedCustomer,
  seedCustomerShadowForUser,
  seedInvite,
  seedOpenOrder,
  seedOrgLink,
  type SeededOrg,
} from '../helpers/session'
import { MemberOperationsPage, PublicBookingPage, orgSlug } from '../pages'

// ── Postgres read-back helpers (aggregate paths → typed projection rows) ──────
// Post-cutover the specs assert against Postgres. The projection columns are
// snake_case (`liquidation_status`, etc.); the rows come back as plain records.

// True when the `member_operations_pii/{id}` sidecar row still exists (RETENTION,
// art. 16). The PII sidecar is keyed by the same aggregate path as the
// memberOperation projection's PII doc.
async function memberOperationPiiExists(
  orgId: string,
  memberOperationId: string,
): Promise<boolean> {
  return pgProjectionExists(
    'member_operations_pii',
    aggregateRef(MemberOperationConfig, orgId, memberOperationId),
  )
}

// True when the invite projection still exists (the AC-09 cleanup DELETES it →
// the row is gone).
async function inviteStillExists(orgId: string, inviteId: string): Promise<boolean> {
  return pgProjectionExists('invites', aggregateRef(InviteConfig, orgId, inviteId))
}

// Reads the membership projection `status` (or null when absent).
async function readMembershipStatus(orgId: string, membershipId: string): Promise<string | null> {
  const row = await pgReadProjection(
    'memberships',
    aggregateRef(MembershipConfig, orgId, membershipId),
  )
  const status = row?.status
  return typeof status === 'string' ? status : null
}

// Reads the appointment projection `status` (or null when absent).
async function readAppointmentStatus(orgId: string, appointmentId: string): Promise<string | null> {
  const row = await pgReadProjection(
    'appointments',
    aggregateRef(AppointmentConfig, orgId, appointmentId),
  )
  const status = row?.status
  return typeof status === 'string' ? status : null
}

// True when the appointment projection still exists (cancelled-but-retained).
async function appointmentExists(orgId: string, appointmentId: string): Promise<boolean> {
  return pgProjectionExists('appointments', aggregateRef(AppointmentConfig, orgId, appointmentId))
}

// Reads the commission projection `liquidation_status` (snake_case column) — or
// null when absent.
async function readCommissionLiquidationStatus(
  orgId: string,
  commissionId: string,
): Promise<string | null> {
  const row = await pgReadProjection(
    'commissions',
    aggregateRef(CommissionConfig, orgId, commissionId),
  )
  const status = row?.liquidation_status
  return typeof status === 'string' ? status : null
}

// True when the agenda-block projection still exists (offboarding cleanup
// assertion, brief 0041 AC-07).
async function blockExists(orgId: string, blockId: string): Promise<boolean> {
  return pgProjectionExists('agenda_blocks', aggregateRef(AgendaBlockConfig, orgId, blockId))
}

// Anonymizes the GLOBAL `users/{uid}` row in place (mirror of #1093's
// `buildUserAnonymizationScrub`): the full PII scrub collapses to the snake_case
// `users` columns in ONE UPDATE so `anonymized_at` lands alongside the nulled PII
// and the `users_anonymized_pii_scrubbed` CHECK never sees a violating state.
async function anonymizeUser(uid: string): Promise<void> {
  const now = new Date().toISOString()
  const scrub = buildUserAnonymizationScrub(now)
  const patched = await patchUser(
    uid,
    {
      display_name: scrub.displayName,
      whatsapp: scrub.whatsapp,
      email: scrub.email,
      birth_date: scrub.birthDate,
      tax_identity: scrub.taxIdentity,
      bio: scrub.bio,
      specialties: scrub.specialties,
      avatar_url: scrub.avatarUrl,
      anonymized_at: scrub.anonymizedAt,
    },
    now,
  )
  if (!patched) throw new Error(`anonymizeUser: user ${uid} not found`)
}

// Blocks a CUSTOMER in a org the way the server action does post-cutover
// (brief 0062 / `block-subject-in-org.ts`): the archived customer shadow IS the
// block marker (fact of record). Stamps `archived_at` on the org's customer row.
async function archiveCustomerShadow(orgId: string, customerId: string): Promise<void> {
  const now = new Date().toISOString()
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      'UPDATE customers SET archived_at = $1, updated_at = $1 WHERE org_id = $2 AND id = $3',
      [now, orgId, customerId],
    )
  } finally {
    await client.end()
  }
}

// Seeds a commission carrying the identity snapshot (`attributedMemberName`) —
// exactly what the order-close flow writes (brief 0041 AC-11). This is the
// retention record whose REAL name must survive revocation/anonymization. A
// matching closed order (in window) keeps the commission in the report scope —
// the report maps commission→unit via `orderId`.
async function seedCommissionWithSnapshot(
  org: SeededOrg,
  c: {
    attributedUserId: string
    attributedMemberName: string
    itemName: string
    createdAt: string
  },
): Promise<string> {
  const orderId = await seedClosedOrder({
    orgId: org.orgId,
    unitId: org.unitIds[0] ?? 'unit',
    customerId: null,
    attributedUserId: c.attributedUserId,
    totalCents: 5000,
    closedAt: c.createdAt,
  })
  return seedCommission({
    orgId: org.orgId,
    attributedUserId: c.attributedUserId,
    amountCents: 2500,
    liquidationStatus: 'pendente',
    orderId,
    itemName: c.itemName,
    attributedMemberName: c.attributedMemberName,
  })
}

test.describe('Offboarding de membro — jornada Feature-level (#1102)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test('Cenário 1: desligamento limpo — cascade completo + registros identificáveis', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    // O fixture seed o User do profissional com displayName "Profissional 1".
    const realName = 'Profissional 1'
    const proEmail = `prof-1-${proId}@e2e.local`
    const customerId = await seedCustomer(org.orgId, { name: 'Cliente Jornada' })

    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const past = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()

    // Future appointment (must be cancelled) + past appointment (must be left).
    const futureAppt = await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: proId,
      customerId,
      serviceId: 'svc-1',
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
    })
    const pastAppt = await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: proId,
      customerId,
      serviceId: 'svc-1',
      startAt: past,
      endAt: new Date(new Date(past).getTime() + 30 * 60_000).toISOString(),
    })
    // The member's agenda-block (must be cleaned) + a org-wide block (kept).
    const proBlock = await seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: proId,
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 60 * 60_000).toISOString(),
      reason: 'folga do profissional',
    })
    const orgBlock = await seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: null,
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 60 * 60_000).toISOString(),
      reason: 'feriado',
    })
    // The member's pending invite (must be cleaned by email).
    const { inviteId } = await seedInvite({
      orgId: org.orgId,
      email: proEmail,
      role: 'member_operator',
      invitedBy: org.uid,
      status: 'pending',
    })
    // A commission carrying the identity snapshot — the retention record whose
    // REAL name must remain identifiable after removal. Dated `now` so it lands
    // in the report's default period (the report scopes by window via the source
    // order's `closedAt`); the retention/identifiability is what this asserts.
    await seedCommissionWithSnapshot(org, {
      attributedUserId: proUserId,
      attributedMemberName: realName,
      itemName: 'Corte da Jornada',
      createdAt: new Date().toISOString(),
    })

    // Baseline: active, approved, PII present, on the team, on public booking.
    expect(await readMembershipStatus(org.orgId, membershipId)).toBe('active')
    expect(await memberOperationPiiExists(org.orgId, proId)).toBe(true)

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoList()
    await expect(authedPage.getByText(realName)).toBeVisible()

    // ── Remove from the member detail (the unified "remover do time" flow). ──
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    // Membership terminal `revoked` (AC-10 — loses access).
    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')

    // Projection RETAINED (not deleted) + PII RETAINED (art. 16). Under #1226
    // AC-02 operability is severed by the REVOKED membership above (every
    // operational surface keys on an active membership) — there is no
    // `member_operation.suspended` event and `operationalStatus` is derived purely
    // from profile facts, so the retained projection keeps its derived value.
    // The revoked membership is what takes the member off the active team list
    // (asserted below) and the agenda.
    expect(await readMemberOperationByUserId(org.orgId, proUserId)).not.toBeNull()
    expect(await memberOperationPiiExists(org.orgId, proId)).toBe(true)

    // Future appointment CANCELLED but RETAINED; past one LEFT.
    await expect.poll(() => readAppointmentStatus(org.orgId, futureAppt)).toBe('cancelled')
    expect(await appointmentExists(org.orgId, futureAppt)).toBe(true)
    expect(await readAppointmentStatus(org.orgId, pastAppt)).toBe('scheduled')

    // Agenda-block cleaned; org-wide block kept (the block-cleanup is a later
    // saga step, so poll for the member's block to disappear).
    await expect.poll(() => blockExists(org.orgId, proBlock)).toBe(false)
    expect(await blockExists(org.orgId, orgBlock)).toBe(true)

    // Pending invite cleaned (the cleanup DELETES the doc → the row is gone).
    await expect.poll(() => inviteStillExists(org.orgId, inviteId)).toBe(false)

    // Gone from the active team list + absent from public booking.
    await pros.gotoList()
    await expect(authedPage.getByText(realName)).toHaveCount(0)
    const publicBooking = new PublicBookingPage(authedPage, orgSlug(org.orgId))
    await publicBooking.gotoUnit('unidade-1')
    await expect(authedPage.getByText(realName)).toHaveCount(0)

    // ── Registros identificáveis: the past commission STILL shows the REAL name
    //    in the report (snapshot, survives revocation — AC-03/AC-11). ──
    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    await expect(authedPage.getByText('Corte da Jornada')).toBeVisible()
    const commissionRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte da Jornada' })
    await expect(commissionRow.getByText(realName)).toBeVisible()
  })

  test('Cenário 2: comanda aberta recusa a remoção (comissão pendente NÃO bloqueia)', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const customerId = await seedCustomer(org.orgId, { name: 'Cliente Comanda' })

    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const apptId = await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: proId,
      customerId,
      serviceId: 'svc-1',
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
    })
    // A PENDING commission (must NOT block — off-system settlement, AC-06).
    // The commission needs a real closed order (FK NOT NULL + RESTRICT, #1220 D2).
    const commissionOrderId = await seedClosedOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId: null,
      attributedUserId: proUserId,
      totalCents: 7000,
    })
    const pendingCommission = await seedCommission({
      orgId: org.orgId,
      attributedUserId: proUserId,
      amountCents: 3500,
      liquidationStatus: 'pendente',
      orderId: commissionOrderId,
    })
    // An OPEN comanda attributed to the member (THE veto — AC-05).
    await seedOpenOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId,
      attributedUserId: proUserId,
    })

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    // Refused with a clear message — and NOTHING was mutated (saga never started).
    await expect(authedPage.getByText(/comanda aberta/i)).toBeVisible()
    expect(await readMembershipStatus(org.orgId, membershipId)).toBe('active')
    expect(await readAppointmentStatus(org.orgId, apptId)).toBe('scheduled')
    // The veto is the OPEN comanda, not the pending commission: the commission
    // is left pending + identifiable (proves the AC-06 reescopo boundary).
    expect(await readCommissionLiquidationStatus(org.orgId, pendingCommission)).toBe('pendente')
  })

  test('Cenário 3: identidade preservada e separada do cliente — as relações nunca cruzam', async ({
    org,
    authedPage,
  }) => {
    // Org A: the seeded org where the subject is a PROFESSIONAL.
    const proId = org.memberOperationIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const realName = 'Profissional 1'
    const now = new Date().toISOString()

    // The SAME person is also a CUSTOMER (per-org shadow) — modelling the
    // cliente-vs-profissional boundary on the SAME global account. The reverse
    // index `org_links/{orgId}` is what a customer-creation saga writes.
    const customerShadowId = await seedCustomerShadowForUser(org.orgId, proUserId)
    await seedOrgLink(proUserId, org.orgId)

    // A retention commission with the identity snapshot (the memberOperation record).
    await seedCommissionWithSnapshot(org, {
      attributedUserId: proUserId,
      attributedMemberName: realName,
      itemName: 'Corte Identidade',
      createdAt: now,
    })

    // Remove the memberOperation from A's team (offboarding).
    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()
    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('revoked')

    // Even revoked, the memberOperation commission stays IDENTIFIABLE (real name).
    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    const revokedRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Identidade' })
    await expect(revokedRow.getByText(realName)).toBeVisible()

    // Now the person exercises CUSTOMER erasure (0032) on their GLOBAL account:
    // scrub the User identity + set `anonymizedAt`, AND write the per-org customer
    // block (post-cutover the block IS the `archived_at` stamp on the customer
    // shadow — brief 0062) — exactly what the customer-side erasure does. The
    // PROFESSIONAL records must NOT be touched.
    await anonymizeUser(proUserId)
    await archiveCustomerShadow(org.orgId, customerShadowId)

    // The customer-side artifacts exist (erasure happened on the cliente relation).
    expect(await blockedSubjectMarkerExists(org.orgId, proUserId)).toBe(true)
    expect(customerShadowId).toBeTruthy()

    // CROSS-RELATIONSHIP SEPARATION — the relations never cross:
    //  (a) the memberOperation commission (retention) STILL shows the REAL name,
    //      read from the snapshot — immune to the global-account anonymization.
    //      A live join would now neutralize to the anonymized label; the snapshot
    //      wins, proving the report reads the memberOperation retention record, not
    //      the customer-erased identity.
    const neutralLabel = anonymizedLabel(proUserId, 'Profissional')
    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    const afterRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Identidade' })
    await expect(afterRow.getByText(realName)).toBeVisible()
    await expect(afterRow.getByText(neutralLabel)).toHaveCount(0)

    //  (b) the memberOperation retention record itself is untouched by the
    //      customer erasure: PII retained, commission still attributed to the
    //      real userId with the real-name snapshot intact.
    expect(await memberOperationPiiExists(org.orgId, proId)).toBe(true)
  })
})
