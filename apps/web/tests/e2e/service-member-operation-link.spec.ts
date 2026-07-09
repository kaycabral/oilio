import { expect, test } from './fixtures'
import { seedService, setActiveUnitCookie } from './helpers/session'
import { MemberOperationsPage, ServicesPage } from './pages'

test.describe('Vínculo Serviço ↔ Profissional', { tag: '@critical' }, () => {
  test.describe('do lado do Profissional', () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('detalhe do membro mostra apenas serviços da unidade do pro', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      await seedService(org.orgId, { name: 'Corte', unitIds: [org.unitIds[0]!] })
      await seedService(org.orgId, { name: 'Manicure', unitIds: [org.unitIds[1]!] })

      await setActiveUnitCookie(context, org.unitIds[0]!, baseURL ?? undefined)

      const memberOperations = new MemberOperationsPage(authedPage)
      await memberOperations.gotoById(org.memberOperationIds[0]!)
      await expect(authedPage.getByText('Serviços que executa')).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Corte' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Manicure' })).toBeVisible()
    })
  })

  test.describe('do lado do Serviço', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 2 } })

    test('/services/[id] cross-edita quais profissionais executam', async ({ org, authedPage }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        unitIds: org.unitIds,
      })
      const services = new ServicesPage(authedPage)
      await services.gotoById(serviceId)
      await expect(authedPage.getByText('Profissionais que executam')).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Profissional 1' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Profissional 2' })).toBeVisible()

      await authedPage.getByRole('checkbox', { name: 'Profissional 1' }).check()
      await authedPage
        .getByText('Profissionais que executam')
        .locator('xpath=ancestor::section')
        .getByRole('button', { name: 'Salvar' })
        .click()
      await expect(authedPage.getByText(/Salvo às/)).toBeVisible()

      await authedPage.reload()
      await expect(authedPage.getByRole('checkbox', { name: 'Profissional 1' })).toBeChecked()
      await expect(authedPage.getByRole('checkbox', { name: 'Profissional 2' })).not.toBeChecked()
    })
  })
})
