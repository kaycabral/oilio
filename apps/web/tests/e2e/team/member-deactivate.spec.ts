// Feature E2E for #1053 (brief 0029 AC-10): deactivate / reactivate a member
// from the member detail at `/team/{userId}`. An owner flips
// `membership.status` active ↔ suspended via the toggle; the transition is
// event-sourced (`membership.updated` carrying `status`), a suspended
// membership loses effective access (the resolvers + the `isMember` rule key on
// `status == 'active'`), and reactivation restores it.
//
// Member-level lifecycle (vacation / dismissal), distinct from `operationalStatus`
// (professional unit-activation, 0028) and `professional.suspended` (role
// lifecycle projection, 0037).
//
// Runs against the emulator (no mocks). Reads the membership doc + its event
// stream straight from Firestore (admin bearer) to assert the projection AND
// the event-sourced transition. The rules-level "suspended can't operate" gate
// is asserted in `firestore-rules.integration.test.ts` (AC-10).

import { defaultPermissionsForRole, membershipDocId } from '@/domain'
import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { parseJson } from '../helpers/firestore-rest'
import { readMembership, seedAuthUser, type SeededTenant } from '../helpers/session'
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

// Seeds an active receptionist membership (admin bypass) for an existing auth
// user, so the member is navigable at `/team/{userId}`. Mirrors the owner
// membership shape.
function seedReceptionistMembership(tenant: SeededTenant, userId: string): void {
  const now = new Date().toISOString()
  const id = membershipDocId(tenant.tenantId, userId)
  const perms = defaultPermissionsForRole('receptionist')
  const boolValue = (b: boolean) => ({ booleanValue: b })
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${FS_BASE}/memberships/${id}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          id: { stringValue: id },
          tenantId: { stringValue: tenant.tenantId },
          userId: { stringValue: userId },
          role: { stringValue: 'receptionist' },
          status: { stringValue: 'active' },
          invitedBy: { stringValue: tenant.uid },
          joinedAt: { stringValue: now },
          updatedAt: { stringValue: now },
          unitId: { nullValue: null },
          commissionRate: { nullValue: null },
          permissions: {
            mapValue: {
              fields: Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, boolValue(v)])),
            },
          },
        },
      }),
    ],
    { stdio: 'pipe' },
  )
}

// Lists the `membership.updated` events on a membership's event stream that
// carry a `status` change, returning the projected status values (event-first
// proof: the transition lives in the immutable stream, not a bare doc write).
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

test.describe('Equipe — desativar/reativar membro (#1053)', { tag: '@critical' }, () => {
  test.use({ tenantInput: { unitCount: 1, professionalCount: 0 } })

  test('detalhe mostra o toggle; desativar suspende; reativar volta; event-sourced', async ({
    tenant,
    authedPage,
  }) => {
    const member = await seedAuthUser()
    seedReceptionistMembership(tenant, member.uid)
    const membershipId = membershipDocId(tenant.tenantId, member.uid)

    // Baseline: active membership, no status-change event yet.
    expect(readMembership(membershipId)?.status).toBe('active')
    expect(listMembershipStatusEvents(membershipId)).toEqual([])

    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(member.uid)

    // The detail renders the toggle reflecting the active state (it offers
    // "Desativar"), beside the read-only status.
    await expect(authedPage.getByRole('group', { name: 'Status', exact: true })).toHaveText('Ativo')
    const toggle = authedPage.getByRole('button', { name: 'Desativar membro' })
    await expect(toggle).toHaveText(/Desativar/)

    // Deactivate → membership.status flips to suspended (the member can't
    // operate; rules-level gate asserted in the integration test).
    await toggle.click()
    await expect.poll(() => readMembership(membershipId)?.status).toBe('suspended')

    // Event-sourced: the transition is recorded as a membership.updated event
    // carrying `status`.
    expect(listMembershipStatusEvents(membershipId)).toContain('suspended')

    // A fresh render reflects the suspended state and now offers "Reativar".
    await pros.gotoByUserId(member.uid)
    await expect(authedPage.getByRole('group', { name: 'Status', exact: true })).toHaveText(
      'Suspenso',
    )
    const reToggle = authedPage.getByRole('button', { name: 'Reativar membro' })
    await expect(reToggle).toHaveText(/Reativar/)

    // Reactivate → back to active, recorded as a second status event.
    await reToggle.click()
    await expect.poll(() => readMembership(membershipId)?.status).toBe('active')
    expect(listMembershipStatusEvents(membershipId)).toEqual(['suspended', 'active'])
  })

  test('owner não tem toggle de desativação (identidade imutável)', async ({
    tenant,
    authedPage,
  }) => {
    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(tenant.uid)
    // The owner detail is read-only and has no deactivate affordance.
    await expect(authedPage.getByRole('form', { name: 'Desativar membro' })).toHaveCount(0)
  })
})
