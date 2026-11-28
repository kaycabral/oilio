import { defaultPermissionsForRole, membershipDocId, roleDescription } from '@/domain'
import { MembershipConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { formatBrazilPhone } from '@cbrl/br/phone'
import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { expectNotFound } from '../helpers/not-found'
import { chooseOption } from '../helpers/select'
import {
  pgReadProjection,
  readMemberOperationByUserId,
  seedAuthUser,
  seedInvite,
  seedMembershipFor,
  seedService,
  uniqueWhatsapp,
} from '../helpers/session'
import { MemberOperationsPage } from '../pages'

test.describe('Equipe como superfície única — DoD (#1084 · 0037)', () => {
  test.describe('Cenário 1 — editar profissional pelo /team', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('detalhe do membro edita campos operacionais com um Salvar; identidade read-only; /memberOperations não existe', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`
      const pros = new MemberOperationsPage(authedPage)

      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()
      await rowAction(authedPage, 'Profissional 1', 'Editar')
      await expect(authedPage).toHaveURL(new RegExp(`/team/${proUid}$`))

      await expect(authedPage.getByRole('button', { name: 'Editar' })).toHaveCount(0)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      await expect(
        authedPage.getByRole('group', { name: 'Comissão padrão', exact: true }),
      ).toBeVisible()
      await expect(authedPage.getByRole('group', { name: 'Unidades', exact: true })).toBeVisible()

      await expect(pros.identityName()).toHaveText('Profissional 1')
      await expect(pros.identityWhatsapp()).toHaveText(/^\(\d{2}\) \d{5}-\d{4}$/)
      await expect(pros.identityEmail()).toContainText('@e2e.local')
      await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="whatsapp"]')).toHaveCount(0)
      await expect(authedPage.locator('input[name="email"]')).toHaveCount(0)

      await seedService(org.orgId, {
        name: 'Corte Jornada',
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
      })
      await pros.gotoByUserId(proUid)
      await authedPage.getByRole('radio', { name: /percentual/i }).check()
      await authedPage.locator('input[name="commissionValue"]').fill('35')
      await authedPage.getByRole('checkbox', { name: 'Corte Jornada' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      await pros.gotoByUserId(proUid)
      await expect(authedPage.locator('input[name="commissionValue"]')).toHaveValue('35')

      await expectNotFound(authedPage, `/memberOperations/${org.memberOperationIds[0]!}`)
    })
  })

  test.describe('Cenário 2 — role-edit →memberOperation materializa', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('owner muda receptionist→memberOperation: projeção materializa, permissões re-derivam, operável ao completar', async ({
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

      const membership = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, member.uid)),
      )
      expect(membership?.role).toBe('member_operator')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('member_operator'))

      await seedService(org.orgId, {
        name: 'Corte Materializado',
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
      })
      await pros.gotoByUserId(member.uid)
      const unitGroup = authedPage.getByRole('group', { name: 'Unidades', exact: true })
      await unitGroup.getByRole('checkbox').first().check()
      await authedPage.getByRole('checkbox', { name: 'Corte Materializado' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      await expect
        .poll(
          async () => (await readMemberOperationByUserId(org.orgId, member.uid))?.operationalStatus,
        )
        .toBe('operational')
    })
  })

  test.describe('Cenário 3 — role-edit memberOperation→outro desativa', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
      },
    })

    test('owner muda memberOperation→receptionist: projeção desativa (sai da agenda, não deleta); sem órfã operável', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`

      expect((await readMemberOperationByUserId(org.orgId, proUid))?.operationalStatus).toBe(
        'operational',
      )

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(proUid)
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveText('Profissional')

      await chooseOption(authedPage, 'Papel', 'Recepção')
      await pros.saveButton().click()

      await expect
        .poll(
          async () =>
            (
              await pgReadProjection(
                'memberships',
                aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, proUid)),
              )
            )?.role,
        )
        .toBe('receptionist')
      expect(await readMemberOperationByUserId(org.orgId, proUid)).not.toBeNull()

      const membership = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, proUid)),
      )
      expect(membership?.role).toBe('receptionist')
      expect(membership?.permissions).toEqual(defaultPermissionsForRole('receptionist'))
    })
  })

  test.describe('Cenário 4 — hierarquia do /team', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 3 } })

    test('Convidar no topo (não afunda) + filtro Status (Pendentes mostra convite); modal mostra descrição do papel', async ({
      org,
      authedPage,
    }) => {
      const pendingWhatsapp = uniqueWhatsapp()
      const pendingDisplay = formatBrazilPhone(pendingWhatsapp)
      await seedInvite({
        orgId: org.orgId,
        mobile: pendingWhatsapp,
        role: 'receptionist',
        invitedBy: org.uid,
      })

      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()

      const convidar = authedPage.getByRole('button', { name: 'Convidar' })
      const firstMember = listItem(authedPage, 'Profissional 1')
      await expect(convidar).toBeVisible()
      await expect(firstMember).toBeVisible()
      const convidarBox = await convidar.boundingBox()
      const memberBox = await firstMember.boundingBox()
      expect(convidarBox).not.toBeNull()
      expect(memberBox).not.toBeNull()
      expect(convidarBox!.y).toBeLessThan(memberBox!.y)

      await expect(authedPage.getByText(pendingDisplay)).toBeVisible()
      await expect(firstMember).toBeVisible()

      await chooseOption(authedPage, 'Status', 'Pendentes')
      await expect(authedPage.getByText(pendingDisplay)).toBeVisible()
      await expect(listItem(authedPage, 'Profissional 1')).toHaveCount(0)

      await authedPage.getByRole('button', { name: 'Convidar' }).click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog.getByText('Convidar membro')).toBeVisible()
      await chooseOption(dialog, 'Papel', 'Profissional')
      await expect(
        dialog.getByRole('note', { name: 'Permissões do papel', exact: true }),
      ).toContainText(roleDescription('member_operator'))
    })
  })

  test.describe('Baseline — render + empty + owner não-editável', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('/team abre só com owner; owner não é link e seu detalhe é read-only', async ({
      org,
      authedPage,
    }) => {
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Convidar' })).toBeVisible()

      const ownerRow = listItem(authedPage, '(você)')
      await expect(ownerRow).toBeVisible()
      await expect(ownerRow.getByRole('button', { name: /^Ações\b/ })).toHaveCount(0)

      await chooseOption(authedPage, 'Status', 'Pendentes')
      await expect(authedPage.getByText('Nenhum convite pendente.')).toBeVisible()

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(org.uid)
      await expect(authedPage.getByRole('group', { name: 'Papel', exact: true })).toHaveText('Dono')
      await expect(authedPage.getByRole('combobox', { name: 'Papel' })).toHaveCount(0)
      await expect(pros.saveButton()).toHaveCount(0)
    })
  })
})
