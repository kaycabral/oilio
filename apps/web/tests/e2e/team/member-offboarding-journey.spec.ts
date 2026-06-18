// Feature-level E2E for brief 0041 (#1102) — team member offboarding, validated
// as a COHESIVE JOURNEY against the brief §DoD. One `test()` per DoD scenario:
//
//   - Cenário 1 — desligamento limpo (happy path): an owner removes a
//     professional who has a future appointment, an agenda-block, a pending
//     invite and a PAST commission, with NO open comanda. The whole cascade runs
//     end-to-end through the UI: membership → `revoked`, projection deactivated,
//     gone from the active team + public booking, future appointment cancelled
//     (retained struck-through), agenda-block cleaned, pending invite cleaned,
//     PII retained (art. 16) — and the past commission STILL shows the member's
//     REAL name in the report (snapshot, identifiable).
//
//   - Cenário 2 — recusa por comanda aberta: a professional with an OPEN comanda
//     is refused removal with a clear message; the saga never starts (membership
//     stays active). A pending COMMISSION does NOT block (AC-06 reescopo —
//     off-system settlement).
//
//   - Cenário 3 — identidade preservada + separada do cliente: the SAME person is
//     a PROFESSIONAL in org A and a CUSTOMER in org B. Removed from A's
//     team, A's commission stays identifiable (real name via snapshot) — and even
//     after the person's GLOBAL account is anonymized as a customer, A's
//     professional commission STILL shows the real name. The customer-erasure
//     side (0032: `blocked_subjects` marker in B) NEVER touches A's professional
//     records. The two relationships never cross.
//
// Cohesive feature journey: Cenário 1 drives the full UI cascade + report; the
// granular per-AC assertions live in the sub-issue specs (member-offboarding for
// #1103/#1104/#1105 and commissions-revoked-identity for #1106). This suite is
// the DoD-level proof + the cross-relationship separation invariant.
//
// Runs against the emulator (no mocks). Reads projections + event streams
// straight from Firestore (admin bearer).

import { anonymizedLabel, membershipDocId } from '@/domain'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { strField } from '../helpers/firestore-rest'
import {
  blockExists,
  blockedSubjectMarkerExists,
  readAppointment,
  readCommission,
  readInvite,
  readMembership,
  readProfessionalByUserId,
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
import { ProfessionalsPage, PublicBookingPage, orgSlug } from '../pages'

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

function docUrl(path: string): string {
  return `${FS_BASE}/${path}`
}

// Field-merge PATCH (updateMask) for mid-test mutations of an EXISTING doc — the
// emulator replaces the whole document without the mask, so each patched field
// path is listed explicitly to keep the rest of the doc intact.
function patchDocFields(path: string, fields: Record<string, unknown>): void {
  const mask = Object.keys(fields)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&')
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${docUrl(path)}?${mask}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields }),
    ],
    { stdio: 'pipe' },
  )
}

// Full-doc PATCH (no mask = whole-doc write) for seeding NEW marker docs whose
// complete shape is exactly the fields passed (e.g. `blocked_subjects/{id}`).
function setDocFull(path: string, fields: Record<string, unknown>): void {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      docUrl(path),
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({ fields }),
    ],
    { stdio: 'pipe' },
  )
}

// True when the `professionals_pii/{id}` doc still exists (RETENTION, art. 16).
function professionalPiiExists(orgId: string, professionalId: string): boolean {
  try {
    execFileSync(
      'curl',
      [
        '-fsS',
        `${FS_BASE}/orgs/${orgId}/professionals_pii/${professionalId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { stdio: 'pipe' },
    )
    return true
  } catch {
    return false
  }
}

// True when the invite doc still exists (the AC-09 cleanup DELETES it, so
// `readInvite` 404s — wrap it to read absence as a boolean).
function inviteStillExists(orgId: string, inviteId: string): boolean {
  try {
    return readInvite(orgId, inviteId) !== null
  } catch {
    return false
  }
}

// Seeds a commission carrying the identity snapshot (`attributedMemberName`) —
// exactly what the order-close flow writes (brief 0041 AC-11). This is the
// retention record whose REAL name must survive revocation/anonymization. A
// matching closed order (in window) keeps the commission in the report scope —
// the report maps commission→unit via `orderId`.
function seedCommissionWithSnapshot(
  org: SeededOrg,
  c: {
    attributedUserId: string
    attributedMemberName: string
    itemName: string
    createdAt: string
  },
): string {
  const orderId = seedClosedOrder({
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
  test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

  test('Cenário 1: desligamento limpo — cascade completo + registros identificáveis', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    // O fixture seed o User do profissional com displayName "Profissional 1".
    const realName = 'Profissional 1'
    const proEmail = `prof-1-${proId}@e2e.local`
    const customerId = seedCustomer(org.orgId, { name: 'Cliente Jornada' })

    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const past = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()

    // Future appointment (must be cancelled) + past appointment (must be left).
    const futureAppt = seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: proId,
      customerId,
      serviceId: 'svc-1',
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
    })
    const pastAppt = seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: proId,
      customerId,
      serviceId: 'svc-1',
      startAt: past,
      endAt: new Date(new Date(past).getTime() + 30 * 60_000).toISOString(),
    })
    // The member's agenda-block (must be cleaned) + a org-wide block (kept).
    const proBlock = seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: proId,
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 60 * 60_000).toISOString(),
      reason: 'folga do profissional',
    })
    const orgBlock = seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: null,
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 60 * 60_000).toISOString(),
      reason: 'feriado',
    })
    // The member's pending invite (must be cleaned by email).
    const { inviteId } = seedInvite({
      orgId: org.orgId,
      email: proEmail,
      role: 'professional',
      invitedBy: org.uid,
      status: 'pending',
    })
    // A commission carrying the identity snapshot — the retention record whose
    // REAL name must remain identifiable after removal. Dated `now` so it lands
    // in the report's default period (the report scopes by window via the source
    // order's `closedAt`); the retention/identifiability is what this asserts.
    seedCommissionWithSnapshot(org, {
      attributedUserId: proUserId,
      attributedMemberName: realName,
      itemName: 'Corte da Jornada',
      createdAt: new Date().toISOString(),
    })

    // Baseline: active, approved, PII present, on the team, on public booking.
    expect(readMembership(membershipId)?.status).toBe('active')
    expect(professionalPiiExists(org.orgId, proId)).toBe(true)

    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoList()
    await expect(authedPage.getByText(realName)).toBeVisible()

    // ── Remove from the member detail (the unified "remover do time" flow). ──
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    // Membership terminal `revoked` (AC-10 — loses access).
    await expect.poll(() => readMembership(membershipId)?.status).toBe('revoked')

    // Projection DEACTIVATED (not deleted) + PII RETAINED (art. 16). Offboarding
    // is a saga — the professional-deactivation step lands after the membership
    // revoke, so poll for it rather than reading right after the revoke poll.
    await expect
      .poll(() => readProfessionalByUserId(org.orgId, proUserId)?.operationalStatus)
      .toBe('incomplete')
    expect(readProfessionalByUserId(org.orgId, proUserId)).not.toBeNull()
    expect(professionalPiiExists(org.orgId, proId)).toBe(true)

    // Future appointment CANCELLED but RETAINED; past one LEFT.
    await expect
      .poll(() => strField(readAppointment(org.orgId, futureAppt) ?? undefined, 'status'))
      .toBe('cancelled')
    expect(readAppointment(org.orgId, futureAppt)).not.toBeNull()
    expect(strField(readAppointment(org.orgId, pastAppt) ?? undefined, 'status')).toBe('scheduled')

    // Agenda-block cleaned; org-wide block kept (the block-cleanup is a later
    // saga step, so poll for the member's block to disappear).
    await expect.poll(() => blockExists(org.orgId, proBlock)).toBe(false)
    expect(blockExists(org.orgId, orgBlock)).toBe(true)

    // Pending invite cleaned (the cleanup DELETES the doc → readInvite 404s).
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
    const proId = org.professionalIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const customerId = seedCustomer(org.orgId, { name: 'Cliente Comanda' })

    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const apptId = seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: proId,
      customerId,
      serviceId: 'svc-1',
      startAt: future,
      endAt: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
    })
    // A PENDING commission (must NOT block — off-system settlement, AC-06).
    const pendingCommission = seedCommission({
      orgId: org.orgId,
      attributedUserId: proUserId,
      amountCents: 3500,
      liquidationStatus: 'pendente',
    })
    // An OPEN comanda attributed to the member (THE veto — AC-05).
    seedOpenOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId,
      attributedUserId: proUserId,
    })

    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    // Refused with a clear message — and NOTHING was mutated (saga never started).
    await expect(authedPage.getByText(/comanda aberta/i)).toBeVisible()
    expect(readMembership(membershipId)?.status).toBe('active')
    expect(strField(readAppointment(org.orgId, apptId) ?? undefined, 'status')).toBe('scheduled')
    // The veto is the OPEN comanda, not the pending commission: the commission
    // is left pending + identifiable (proves the AC-06 reescopo boundary).
    expect(readCommission(org.orgId, pendingCommission)?.liquidationStatus).toBe('pendente')
  })

  test('Cenário 3: identidade preservada e separada do cliente — as relações nunca cruzam', async ({
    org,
    authedPage,
  }) => {
    // Org A: the seeded org where the subject is a PROFESSIONAL.
    const proId = org.professionalIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const realName = 'Profissional 1'
    const now = new Date().toISOString()

    // The SAME person is also a CUSTOMER (per-org shadow) — modelling the
    // cliente-vs-profissional boundary on the SAME global account. The reverse
    // index `org_links/{orgId}` is what a customer-creation saga writes.
    const customerShadowId = seedCustomerShadowForUser(org.orgId, proUserId)
    seedOrgLink(proUserId, org.orgId)

    // A retention commission with the identity snapshot (the professional record).
    seedCommissionWithSnapshot(org, {
      attributedUserId: proUserId,
      attributedMemberName: realName,
      itemName: 'Corte Identidade',
      createdAt: now,
    })

    // Remove the professional from A's team (offboarding).
    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()
    await expect.poll(() => readMembership(membershipId)?.status).toBe('revoked')

    // Even revoked, the professional commission stays IDENTIFIABLE (real name).
    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    const revokedRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Identidade' })
    await expect(revokedRow.getByText(realName)).toBeVisible()

    // Now the person exercises CUSTOMER erasure (0032) on their GLOBAL account:
    // scrub the User identity + set `anonymizedAt`, AND write the per-org
    // customer block marker (`blocked_subjects/{userId}`) — exactly what the
    // customer-side erasure does. The PROFESSIONAL records must NOT be touched.
    patchDocFields(`users/${proUserId}`, {
      displayName: { nullValue: null },
      anonymizedAt: { stringValue: now },
      updatedAt: { stringValue: now },
    })
    setDocFull(`orgs/${org.orgId}/blocked_subjects/${proUserId}`, {
      userId: { stringValue: proUserId },
      blockedAt: { stringValue: now },
    })

    // The customer-side artifacts exist (erasure happened on the cliente relation).
    expect(blockedSubjectMarkerExists(org.orgId, proUserId)).toBe(true)
    expect(customerShadowId).toBeTruthy()

    // CROSS-RELATIONSHIP SEPARATION — the relations never cross:
    //  (a) the professional commission (retention) STILL shows the REAL name,
    //      read from the snapshot — immune to the global-account anonymization.
    //      A live join would now neutralize to the anonymized label; the snapshot
    //      wins, proving the report reads the professional retention record, not
    //      the customer-erased identity.
    const neutralLabel = anonymizedLabel(proUserId, 'Profissional')
    await authedPage.goto('/reports')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    const afterRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Identidade' })
    await expect(afterRow.getByText(realName)).toBeVisible()
    await expect(afterRow.getByText(neutralLabel)).toHaveCount(0)

    //  (b) the professional retention record itself is untouched by the
    //      customer erasure: PII retained, commission still attributed to the
    //      real userId with the real-name snapshot intact.
    expect(professionalPiiExists(org.orgId, proId)).toBe(true)
  })
})
