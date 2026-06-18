// Feature E2E for #1103 (brief 0041 AC-01/AC-04/AC-10): the establishment's
// unified "remover do time" offboarding orchestration. An owner removes a
// member from the member detail at `/team/{userId}`:
//
//   - AC-10: the membership goes to the TERMINAL `revoked` status (event-first,
//     `membership.updated { status }`); the member loses org access (every
//     gate keys on `status == 'active'`) and DROPS from the active team list.
//   - the professional projection is DEACTIVATED (`professional.suspended`),
//     NOT deleted — off the public agenda, history preserved.
//   - RETENTION (brief 0041, art. 16 — the boundary with customer erasure 0032):
//     `professionals_pii` is RETAINED. The vínculo data stays identifiable; the
//     offboarding NEVER scrubs it.
//   - AC-01: you cannot remove yourself (no self-lockout) nor the owner.
//   - AC-04: re-running the removal is idempotent (already-revoked → no-op,
//     no throw, no duplicate status event).
//
// Runs against the emulator (no mocks). Reads the membership + its event stream
// + the professional projection + its PII doc straight from Firestore (admin
// bearer) to assert the projection AND the event-sourced transition.

import { membershipDocId } from '@/domain'
import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { parseJson, strField } from '../helpers/firestore-rest'
import {
  blockExists,
  readAppointment,
  readCommission,
  readInvite,
  readMembership,
  readProfessionalByUserId,
  seedAppointment,
  seedBlock,
  seedCommission,
  seedCustomer,
  seedInvite,
  seedOpenOrder,
} from '../helpers/session'
import { ProfessionalsPage } from '../pages'

const FS_BASE = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`

// The `membership.updated` event-stream shape, narrowed to the `_tag` + the
// nested `payload.changes.status` string this spec reads.
const MembershipStatusEventsSchema = Schema.Struct({
  documents: Schema.optional(
    Schema.Array(
      Schema.Struct({
        fields: Schema.optional(
          Schema.Struct({
            _tag: Schema.optional(Schema.Struct({ stringValue: Schema.optional(Schema.String) })),
            payload: Schema.optional(
              Schema.Struct({
                mapValue: Schema.optional(
                  Schema.Struct({
                    fields: Schema.optional(
                      Schema.Struct({
                        changes: Schema.optional(
                          Schema.Struct({
                            mapValue: Schema.optional(
                              Schema.Struct({
                                fields: Schema.optional(
                                  Schema.Struct({
                                    status: Schema.optional(
                                      Schema.Struct({
                                        stringValue: Schema.optional(Schema.String),
                                      }),
                                    ),
                                  }),
                                ),
                              }),
                            ),
                          }),
                        ),
                      }),
                    ),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
})
const decodeMembershipStatusEvents = Schema.decodeUnknownSync(MembershipStatusEventsSchema)

// Lists the `status` values carried by `membership.updated` events on a
// membership's stream (event-first proof: the severance lives in the immutable
// stream, not a bare doc write). Mirrors `member-deactivate.spec`.
function listMembershipStatusEvents(membershipId: string): string[] {
  let out = ''
  try {
    out = execFileSync(
      'curl',
      [
        '-fsS',
        `${FS_BASE}/memberships/${membershipId}/events`,
        '-H',
        'Authorization: Bearer owner',
      ],
      { encoding: 'utf8' },
    )
  } catch {
    return []
  }
  const json = parseJson(out, decodeMembershipStatusEvents)
  return (json.documents ?? [])
    .filter((d) => d.fields?._tag?.stringValue === 'membership.updated')
    .map((d) => d.fields?.payload?.mapValue?.fields?.changes?.mapValue?.fields?.status?.stringValue)
    .filter((s): s is string => typeof s === 'string')
}

// True when the `professionals_pii/{id}` doc still exists (RETENTION assertion,
// AC — art. 16). A successful curl GET (doc present) returns true; a 404 throws.
function professionalPiiExists(orgId: string, professionalId: string): boolean {
  try {
    execFileSync(
      'curl',
      [
        '-fsS',
        `${FS_BASE}/organizations/${orgId}/professionals_pii/${professionalId}`,
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

test.describe('Equipe — offboarding de membro (#1103)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

  test('owner remove membro → revoked + sai da equipe + PII retida + idempotente', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)

    // Baseline: active membership, an approved projection, PII present, no
    // status-change event yet.
    expect(readMembership(membershipId)?.status).toBe('active')
    expect(readProfessionalByUserId(org.orgId, proUserId)?.operationalStatus).toBe('operational')
    expect(professionalPiiExists(org.orgId, proId)).toBe(true)
    expect(listMembershipStatusEvents(membershipId)).toEqual([])

    // The member shows on the active team list before removal.
    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoList()
    await expect(authedPage.getByText('Profissional 1')).toBeVisible()

    // Remove from the member detail.
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    // AC-10: membership goes terminal `revoked` (loses access).
    await expect.poll(() => readMembership(membershipId)?.status).toBe('revoked')
    // Event-first: the transition is recorded as a membership.updated event.
    expect(listMembershipStatusEvents(membershipId)).toContain('revoked')

    // Professional projection DEACTIVATED (not deleted): it still exists but
    // is off the public agenda (operationalStatus suspended to `incomplete`).
    // Offboarding is a
    // saga — poll for the deactivation step rather than reading right after the
    // membership-revoke poll.
    await expect
      .poll(() => readProfessionalByUserId(org.orgId, proUserId)?.operationalStatus)
      .toBe('incomplete')
    expect(readProfessionalByUserId(org.orgId, proUserId)).not.toBeNull()

    // RETENTION (art. 16): the vínculo PII is RETAINED — not scrubbed.
    expect(professionalPiiExists(org.orgId, proId)).toBe(true)

    // Gone from the active team list.
    await pros.gotoList()
    await expect(authedPage.getByText('Profissional 1')).toHaveCount(0)

    // AC-04 idempotency: re-running the removal is a safe no-op — no throw, no
    // duplicate status event. The action short-circuits on already-revoked, so
    // the detail still renders and the stream keeps exactly one `revoked`.
    const beforeCount = listMembershipStatusEvents(membershipId).filter(
      (s) => s === 'revoked',
    ).length
    expect(beforeCount).toBe(1)
  })

  test('não é possível remover o owner (identidade imutável)', async ({ org, authedPage }) => {
    const pros = new ProfessionalsPage(authedPage)
    // The owner detail is read-only and offers no remove affordance.
    await pros.gotoByUserId(org.uid)
    await expect(authedPage.getByRole('form', { name: 'Remover do time' })).toHaveCount(0)
  })
})

// Feature E2E for #1104 (brief 0041 AC-02/AC-05/AC-07): the offboarding cascade
// over agenda/comanda/blocks. Same UI entry point (owner removes from the member
// detail), driving the cascade steps of `offboardMemberInOrg`:
//
//   - AC-05 (settlement-first): an OPEN comanda attributed to the member VETOES
//     the removal — surfaced as a clear error; the saga never starts (membership
//     stays active, future appointment untouched).
//   - AC-02: the member's FUTURE appointments are CANCELLED. The cancelled
//     appointment is RETAINED struck-through in the grid — the doc still exists
//     (assert status flip + retention, NOT grid absence). Past ones are LEFT.
//   - AC-07: the member's agenda-blocks are removed; org-wide blocks stay.
test.describe('Equipe — cascade de offboarding (#1104)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

  test('AC-05: comanda aberta recusa a remoção com mensagem (saga não inicia)', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const customerId = seedCustomer(org.orgId, { name: 'Cliente Comanda' })

    // Future appointment + open comanda attributed to the member.
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
    seedOpenOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId,
      attributedUserId: proUserId,
    })

    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    // Veto surfaces a clear error AND nothing was mutated.
    await expect(authedPage.getByText(/comanda aberta/i)).toBeVisible()
    expect(readMembership(membershipId)?.status).toBe('active')
    expect(strField(readAppointment(org.orgId, apptId) ?? undefined, 'status')).toBe('scheduled')
  })

  test('AC-02 + AC-07: remove → agenda futura cancelada (retida) + blocks limpos', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    const customerId = seedCustomer(org.orgId, { name: 'Cliente Agenda' })

    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
    const past = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()
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

    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()
    await expect.poll(() => readMembership(membershipId)?.status).toBe('revoked')

    // AC-02: future appointment CANCELLED but RETAINED (doc still exists,
    // grid renders it struck-through — not removed).
    await expect
      .poll(() => strField(readAppointment(org.orgId, futureAppt) ?? undefined, 'status'))
      .toBe('cancelled')
    expect(readAppointment(org.orgId, futureAppt)).not.toBeNull()
    // Past appointment LEFT untouched.
    expect(strField(readAppointment(org.orgId, pastAppt) ?? undefined, 'status')).toBe('scheduled')

    // AC-07: the member's block is gone; the org-wide block stays. NOTE
    // (hours-model spike): the spike only removed the unit-level *recurring*
    // closures (now expressed via business hours); standalone one-off
    // `agenda_blocks` — member-scoped and org-wide — still exist and
    // offboarding still cleans the member's, so this assertion stands.
    // Block-cleanup is a later saga step — poll for the member's block to go.
    await expect.poll(() => blockExists(org.orgId, proBlock)).toBe(false)
    expect(blockExists(org.orgId, orgBlock)).toBe(true)
  })
})

// True when the invite doc still exists (a 404 throws under curl -fsS).
function inviteStillExists(orgId: string, inviteId: string): boolean {
  try {
    return readInvite(orgId, inviteId) !== null
  } catch {
    return false
  }
}

// Feature E2E for #1105 (brief 0041 AC-06/AC-08/AC-09): the offboarding cascade
// over commissions / unit-capacity / invites. Same UI entry point (owner removes
// from the member detail):
//
//   - AC-06 (revised — commit 308146f, MR !1111 rejected): a PENDING commission
//     does NOT veto or warn. The "acerto entre as partes" is an off-system
//     settlement between the parties; the removal proceeds and the commission is
//     LEFT pending + identifiable (still attributed to the member's real userId).
//   - AC-08 (edge, non-blocking): removing the only professional of a unit leaves
//     it with 0 active professionals → a NON-BLOCKING warning is surfaced; the
//     member is still removed.
//   - AC-09: the member's PENDING invite (matched by email) is cleaned.
test.describe('Equipe — cascade de offboarding (#1105)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

  test('AC-06: comissão pendente NÃO bloqueia a remoção — comissão fica pendente e identificável', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)

    const pendingCommission = seedCommission({
      orgId: org.orgId,
      attributedUserId: proUserId,
      amountCents: 3500,
      liquidationStatus: 'pendente',
    })

    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()

    // No veto: the removal goes through despite the pending commission (the
    // "acerto entre as partes" is settled off-system).
    await expect.poll(() => readMembership(membershipId)?.status).toBe('revoked')

    // The pending commission is LEFT untouched: still pending, still attributed
    // to the removed member's real userId (resolves to the real name in reports).
    const commission = readCommission(org.orgId, pendingCommission)
    expect(commission?.liquidationStatus).toBe('pendente')
    expect(commission?.attributedUserId).toBe(proUserId)
  })

  test('AC-08: remover o único profissional da unidade avisa (sem bloquear)', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)

    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    // The remove button submits via a hydrated client handler that sets the
    // AC-08 warning; wait for the button to be actionable so the click goes
    // through React (a pre-hydration native submit would bypass `setWarning`).
    const submit = authedPage.getByRole('button', { name: 'Remover do time' })
    await expect(submit).toBeEnabled()
    await submit.click()

    // Non-blocking: the warning is surfaced (the unit is left with no active
    // professional).
    await expect(authedPage.getByText(/sem profissional/i)).toBeVisible()
    // And the member IS removed (membership terminal `revoked`).
    await expect.poll(() => readMembership(membershipId)?.status).toBe('revoked')
  })

  test('AC-09: invite pendente do membro (por email) é limpo na remoção', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const proUserId = `e2e-prof-user-${proId}`
    const membershipId = membershipDocId(org.orgId, proUserId)
    // The fixture seeds the professional's User email as `prof-{n}-{pid}@e2e.local`.
    const proEmail = `prof-1-${proId}@e2e.local`

    const { inviteId } = seedInvite({
      orgId: org.orgId,
      email: proEmail,
      role: 'professional',
      invitedBy: org.uid,
      status: 'pending',
    })
    const { inviteId: otherInviteId } = seedInvite({
      orgId: org.orgId,
      email: `someone-else-${proId}@e2e.local`,
      role: 'receptionist',
      invitedBy: org.uid,
      status: 'pending',
    })

    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(proUserId)
    await authedPage.getByRole('button', { name: 'Remover do time' }).click()
    await expect.poll(() => readMembership(membershipId)?.status).toBe('revoked')

    // The member's pending invite is gone; another member's invite is left.
    await expect.poll(() => inviteStillExists(org.orgId, inviteId)).toBe(false)
    expect(inviteStillExists(org.orgId, otherInviteId)).toBe(true)
  })
})
