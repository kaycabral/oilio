import { membershipDocId } from '@/domain'
import { MembershipConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import {
  pgReadEventStream,
  pgReadProjection,
  seedAuthUser,
  seedMembershipFor,
} from '../helpers/session'
import { MemberOperationsPage } from '../pages'

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

async function listMembershipStatusEvents(orgId: string, membershipId: string): Promise<string[]> {
  const stream = await pgReadEventStream(aggregateRef(MembershipConfig, orgId, membershipId))
  return stream
    .map((e) => decodeMembershipStatusEvent(e))
    .filter((e) => e._tag === 'membership.updated')
    .map((e) => e.payload?.changes?.status)
    .filter((s): s is string => typeof s === 'string')
}

async function readMembershipStatus(orgId: string, membershipId: string): Promise<string | null> {
  const row = await pgReadProjection(
    'memberships',
    aggregateRef(MembershipConfig, orgId, membershipId),
  )
  return typeof row?.status === 'string' ? row.status : null
}

test.describe('Equipe — desativar/reativar membro (#1053)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

  test('detalhe mostra o toggle; desativar suspende; reativar volta; event-sourced', async ({
    org,
    authedPage,
  }) => {
    const member = await seedAuthUser()
    await seedMembershipFor(org.orgId, member.uid, { role: 'receptionist' })
    const membershipId = membershipDocId(org.orgId, member.uid)

    expect(await readMembershipStatus(org.orgId, membershipId)).toBe('active')
    expect(await listMembershipStatusEvents(org.orgId, membershipId)).toEqual([])

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(member.uid)

    await expect(authedPage.getByRole('group', { name: 'Status', exact: true })).toHaveText('Ativo')
    const toggle = authedPage.getByRole('button', { name: 'Desativar membro' })
    await expect(toggle).toHaveText(/Desativar/)

    await toggle.click()
    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('suspended')

    expect(await listMembershipStatusEvents(org.orgId, membershipId)).toContain('suspended')

    await pros.gotoByUserId(member.uid)
    await expect(authedPage.getByRole('group', { name: 'Status', exact: true })).toHaveText(
      'Suspenso',
    )
    const reToggle = authedPage.getByRole('button', { name: 'Reativar membro' })
    await expect(reToggle).toHaveText(/Reativar/)

    await reToggle.click()
    await expect.poll(() => readMembershipStatus(org.orgId, membershipId)).toBe('active')
    expect(await listMembershipStatusEvents(org.orgId, membershipId)).toEqual([
      'suspended',
      'active',
    ])
  })

  test('owner não tem toggle de desativação (identidade imutável)', async ({ org, authedPage }) => {
    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoByUserId(org.uid)
    await expect(authedPage.getByRole('form', { name: 'Desativar membro' })).toHaveCount(0)
  })
})
