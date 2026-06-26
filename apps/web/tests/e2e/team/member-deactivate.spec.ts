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
// Runs against the emulator (no mocks). Reads the membership projection + its
// event stream straight from Postgres (post-cutover) to assert the projection
// AND the event-sourced transition. The rules-level "suspended can't operate"
// gate is asserted in the rules integration test (AC-10).

import { membershipDocId } from '@/domain'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import {
  pgReadEventStream,
  pgReadProjection,
  seedAuthUser,
  seedMembershipFor,
} from '../helpers/session'
import { ProfessionalsPage } from '../pages'

// The `membership.updated` event-stream envelope, narrowed to the `_tag` + the
// nested `payload.changes.status` string this spec reads. Excess envelope fields
// (version/timestamp/actorId/schemaVersion) are ignored by the lenient struct.
const MembershipStatusEventSchema = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  payload: Schema.optional(
    Schema.Struct({
      changes: Schema.optional(
        Schema.Struct({
          status: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
})
const decodeMembershipStatusEvent = Schema.decodeUnknownSync(MembershipStatusEventSchema)

// Lists the `membership.updated` events on a membership's event stream that
// carry a `status` change, returning the projected status values (event-first
// proof: the transition lives in the immutable stream, not a bare doc write).
async function listMembershipStatusEvents(membershipId: string): Promise<string[]> {
  const stream = await pgReadEventStream(`memberships/${membershipId}`)
  return stream
    .map((e) => decodeMembershipStatusEvent(e))
    .filter((e) => e._tag === 'membership.updated')
    .map((e) => e.payload?.changes?.status)
    .filter((s): s is string => typeof s === 'string')
}

// Reads the membership projection's `status` straight from Postgres (the
// memberships table is top-level — aggregate_path `memberships/{id}`).
async function readMembershipStatus(membershipId: string): Promise<string | null> {
  const row = await pgReadProjection('memberships', `memberships/${membershipId}`)
  return typeof row?.status === 'string' ? row.status : null
}

test.describe('Equipe — desativar/reativar membro (#1053)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, professionalCount: 0 } })

  test('detalhe mostra o toggle; desativar suspende; reativar volta; event-sourced', async ({
    org,
    authedPage,
  }) => {
    const member = await seedAuthUser()
    await seedMembershipFor(org.orgId, member.uid, { role: 'receptionist' })
    const membershipId = membershipDocId(org.orgId, member.uid)

    // Baseline: active membership, no status-change event yet.
    expect(await readMembershipStatus(membershipId)).toBe('active')
    expect(await listMembershipStatusEvents(membershipId)).toEqual([])

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
    await expect.poll(() => readMembershipStatus(membershipId)).toBe('suspended')

    // Event-sourced: the transition is recorded as a membership.updated event
    // carrying `status`.
    expect(await listMembershipStatusEvents(membershipId)).toContain('suspended')

    // A fresh render reflects the suspended state and now offers "Reativar".
    await pros.gotoByUserId(member.uid)
    await expect(authedPage.getByRole('group', { name: 'Status', exact: true })).toHaveText(
      'Suspenso',
    )
    const reToggle = authedPage.getByRole('button', { name: 'Reativar membro' })
    await expect(reToggle).toHaveText(/Reativar/)

    // Reactivate → back to active, recorded as a second status event.
    await reToggle.click()
    await expect.poll(() => readMembershipStatus(membershipId)).toBe('active')
    expect(await listMembershipStatusEvents(membershipId)).toEqual(['suspended', 'active'])
  })

  test('owner não tem toggle de desativação (identidade imutável)', async ({ org, authedPage }) => {
    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoByUserId(org.uid)
    // The owner detail is read-only and has no deactivate affordance.
    await expect(authedPage.getByRole('form', { name: 'Desativar membro' })).toHaveCount(0)
  })
})
