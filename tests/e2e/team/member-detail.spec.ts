import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { seedAuthUser, seedMembershipFor, seedService } from '../helpers/session'
import { MemberOperationsPage } from '../pages'

test.describe('Equipe — detalhe do membro (#1085)', { tag: '@critical' }, () => {
  test.describe('membro profissional', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('lista leva ao detalhe; profissional mostra campos operacionais direto (sem Editar); identidade read-only no topo', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`

      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()
      await rowAction(authedPage, 'Profissional 1', 'Editar')
      await expect(authedPage).toHaveURL(new RegExp(`/team/${proUid}$`))

      const pros = new MemberOperationsPage(authedPage)

      await expect(authedPage.getByRole('button', { name: 'Editar' })).toHaveCount(0)
      await expect(pros.roleSelect()).toHaveText('Profissional')
      await expect(authedPage.getByRole('group', { name: 'Status', exact: true })).toHaveText(
        'Ativo',
      )

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
    })

    test('editar campos operacionais (comissão + serviço) com um Salvar reflete', async ({
      org,
      authedPage,
    }) => {
      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`
      await seedService(org.orgId, {
        name: 'Corte Detalhe',
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
      })

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(proUid)

      await authedPage.getByRole('radio', { name: /percentual/i }).check()
      await authedPage.locator('input[name="commissionValue"]').fill('40')
      await authedPage.getByRole('checkbox', { name: 'Corte Detalhe' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      await pros.gotoByUserId(proUid)
      await expect(authedPage.getByRole('radio', { name: /percentual/i })).toBeChecked()
      await expect(authedPage.locator('input[name="commissionValue"]')).toHaveValue('40')
    })
  })

  test.describe('membro não-profissional (AC-03)', () => {
    test('detalhe mostra role select + Salvar, sem campos operacionais nem Editar', async ({
      org,
      authedPage,
    }) => {
      const member = await seedAuthUser()
      await seedMembershipFor(org.orgId, member.uid, { role: 'receptionist' })

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(member.uid)

      await expect(pros.roleSelect()).toHaveText('Recepção')
      await expect(authedPage.getByRole('group', { name: 'Status', exact: true })).toHaveText(
        'Ativo',
      )
      await expect(authedPage.getByRole('button', { name: 'Editar' })).toHaveCount(0)

      await expect(
        authedPage.getByRole('group', { name: 'Comissão padrão', exact: true }),
      ).toHaveCount(0)
      await expect(pros.saveButton()).toBeVisible()
    })
  })

  test.describe('owner não-editável (refino A)', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('owner não é link na lista e seu detalhe é read-only', async ({ org, authedPage }) => {
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()

      const ownerRow = listItem(authedPage, '(você)')
      await expect(ownerRow).toBeVisible()
      await expect(ownerRow.getByRole('button', { name: /^Ações\b/ })).toHaveCount(0)

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(org.uid)
      await expect(authedPage.getByRole('group', { name: 'Papel', exact: true })).toHaveText('Dono')
      await expect(pros.roleSelect()).toHaveCount(0)
      await expect(pros.saveButton()).toHaveCount(0)
    })
  })

  test.describe('baseline — só o owner (#17)', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('render + detalhe do owner abre read-only, sem campos operacionais', async ({
      org,
      authedPage,
    }) => {
      await authedPage.goto('/team')
      await expect(authedPage.getByRole('heading', { name: 'Equipe' })).toBeVisible()

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(org.uid)
      await expect(authedPage.getByRole('group', { name: 'Papel', exact: true })).toHaveText('Dono')
      await expect(pros.roleSelect()).toHaveCount(0)
      await expect(pros.saveButton()).toHaveCount(0)
    })
  })
})
