import { defaultPermissionsForRole, membershipDocId, MembershipPermissions, Role } from '@/domain'
import { MembershipConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { chooseOption } from '../helpers/select'
import {
  pgReadProjection,
  readMemberOperationByUserId,
  seedAuthUser,
  seedMembershipFor,
  seedService,
} from '../helpers/session'
import { MemberOperationsPage } from '../pages'

async function readMembershipProjection(
  orgId: string,
  membershipId: string,
): Promise<{ role: typeof Role.Type; permissions: MembershipPermissions } | null> {
  const row = await pgReadProjection(
    'memberships',
    aggregateRef(MembershipConfig, orgId, membershipId),
  )
  if (!row) return null
  return {
    role: Schema.decodeUnknownSync(Role)(row.role),
    permissions: Schema.decodeUnknownSync(MembershipPermissions)(row.permissions),
  }
}

test.describe('Equipe — role-edit com lifecycle (#1086)', { tag: '@critical' }, () => {
  test.describe('receptionist → memberOperation materializa a projeção', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('troca de papel materializa a projeção (não-operável até o perfil completar)', async ({
      org,
      authedPage,
    }) => {
      const member = await seedAuthUser()
      await seedMembershipFor(org.orgId, member.uid, { role: 'receptionist' })

      expect(await readMemberOperationByUserId(org.orgId, member.uid)).toBeNull()

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(member.uid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Recepção')

      await chooseOption(authedPage, 'Papel', 'Profissional')
      await pros.saveButton().click()

      await expect
        .poll(
          async () => (await readMemberOperationByUserId(org.orgId, member.uid))?.operationalStatus,
        )
        .toBe('incomplete')

      await pros.gotoByUserId(member.uid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      const membership = await readMembershipProjection(
        org.orgId,
        membershipDocId(org.orgId, member.uid),
      )
      expect(membership?.role).toBe('member_operator')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('member_operator'))

      const svc = await seedService(org.orgId, {
        name: 'Corte Operável',
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
      })
      await pros.gotoByUserId(member.uid)
      const unitGroup = authedPage.getByRole('group', { name: 'Unidades', exact: true })
      await unitGroup.getByRole('checkbox').first().check()
      await authedPage.getByRole('checkbox', { name: 'Corte Operável' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      const afterProfile = await readMemberOperationByUserId(org.orgId, member.uid)
      expect(afterProfile?.operationalStatus).toBe('operational')
      expect(svc).toBeTruthy()
    })
  })

  test.describe('memberOperation → receptionist desativa a projeção', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
      },
    })

    test('demoção desativa a projeção (sai da agenda) sem deletar; permissões re-derivam', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`

      const before = await readMemberOperationByUserId(org.orgId, proUid)
      expect(before?.operationalStatus).toBe('operational')

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(proUid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      await chooseOption(authedPage, 'Papel', 'Recepção')
      await pros.saveButton().click()
      await expect
        .poll(
          async () =>
            (await readMembershipProjection(org.orgId, membershipDocId(org.orgId, proUid)))?.role,
        )
        .toBe('receptionist')
      const after = await readMemberOperationByUserId(org.orgId, proUid)
      expect(after).not.toBeNull()

      const membership = await readMembershipProjection(
        org.orgId,
        membershipDocId(org.orgId, proUid),
      )
      expect(membership?.role).toBe('receptionist')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('receptionist'))
    })
  })
})
