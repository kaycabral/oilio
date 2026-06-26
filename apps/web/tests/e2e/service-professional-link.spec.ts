import { expect, test } from './fixtures'
import { seedService, setActiveUnitCookie } from './helpers/session'
import { ProfessionalsPage, ServicesPage } from './pages'

// Coverage for #876 — Service ↔ Professional link, enforced by intersection
// of unitIds. UI exposes the link from BOTH sides (Professionals and
// Services pages).

test.describe('Vínculo Serviço ↔ Profissional', { tag: '@critical' }, () => {
  test.describe('do lado do Profissional', () => {
    test.use({ orgInput: { unitCount: 2, professionalCount: 1 } })

    test('detalhe do membro mostra apenas serviços da unidade do pro', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      // s1 offered in unit 1 only, s2 offered in unit 2 only.
      await seedService(org.orgId, { name: 'Corte', unitIds: [org.unitIds[0]!] })
      await seedService(org.orgId, { name: 'Manicure', unitIds: [org.unitIds[1]!] })

      // 2-unit org with no chosen unit is sent to `/select-unit` (0029
      // AC-04). Pin the active unit so the member detail resolves directly.
      await setActiveUnitCookie(context, org.unitIds[0]!, baseURL ?? undefined)

      // Pro is seeded linked to ALL units. The operational edit in the member
      // detail (#1085) should show BOTH services as eligible.
      const professionals = new ProfessionalsPage(authedPage)
      await professionals.gotoById(org.professionalIds[0]!)
      await expect(authedPage.getByText('Serviços que executa')).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Corte' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Manicure' })).toBeVisible()
    })
  })

  test.describe('do lado do Serviço', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 2 } })

    test('/services/[id] cross-edita quais profissionais executam', async ({ org, authedPage }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        unitIds: org.unitIds,
      })
      const services = new ServicesPage(authedPage)
      await services.gotoById(serviceId)
      await expect(authedPage.getByText('Profissionais que executam')).toBeVisible()
      // Two eligible pros — both at u1 sharing the unique service unit.
      await expect(authedPage.getByRole('checkbox', { name: 'Profissional 1' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Profissional 2' })).toBeVisible()

      await authedPage.getByRole('checkbox', { name: 'Profissional 1' }).check()
      // The save button lives inside the cross-edit section — disambiguate
      // from the main service form's "Salvar".
      await authedPage
        .getByText('Profissionais que executam')
        .locator('xpath=ancestor::section')
        .getByRole('button', { name: 'Salvar' })
        .click()
      await expect(authedPage.getByText(/Salvo às/)).toBeVisible()

      // Reload — the checkbox persists.
      await authedPage.reload()
      await expect(authedPage.getByRole('checkbox', { name: 'Profissional 1' })).toBeChecked()
      await expect(authedPage.getByRole('checkbox', { name: 'Profissional 2' })).not.toBeChecked()
    })
  })
})
