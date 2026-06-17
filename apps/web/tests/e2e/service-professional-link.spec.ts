import { expect, test } from './fixtures'
import { seedService, setActiveUnitCookie } from './helpers/session'
import { ProfessionalsPage, ServicesPage } from './pages'

// Coverage for #876 — Service ↔ Professional link, enforced by intersection
// of unitIds. UI exposes the link from BOTH sides (Professionals and
// Services pages).

test.describe('Vínculo Serviço ↔ Profissional', { tag: '@critical' }, () => {
  test.describe('do lado do Profissional', () => {
    test.use({ tenantInput: { unitCount: 2, professionalCount: 1 } })

    test('detalhe do membro mostra apenas serviços da unidade do pro', async ({
      context,
      tenant,
      authedPage,
      baseURL,
    }) => {
      // s1 offered in unit 1 only, s2 offered in unit 2 only.
      seedService(tenant.tenantId, { name: 'Corte', unitIds: [tenant.unitIds[0]!] })
      seedService(tenant.tenantId, { name: 'Manicure', unitIds: [tenant.unitIds[1]!] })

      // 2-unit tenant with no chosen unit is sent to `/select-unit` (0029
      // AC-04). Pin the active unit so the member detail resolves directly.
      await setActiveUnitCookie(context, tenant.unitIds[0]!, baseURL ?? undefined)

      // Pro is seeded linked to ALL units. The operational edit in the member
      // detail (#1085) should show BOTH services as eligible.
      const professionals = new ProfessionalsPage(authedPage)
      await professionals.gotoById(tenant.professionalIds[0]!)
      await expect(authedPage.getByText('Serviços que executa')).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Corte' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Manicure' })).toBeVisible()
    })
  })

  test.describe('do lado do Serviço', () => {
    test.use({ tenantInput: { unitCount: 1, professionalCount: 2 } })

    test('/services/[id] cross-edita quais profissionais executam', async ({
      tenant,
      authedPage,
    }) => {
      const serviceId = seedService(tenant.tenantId, {
        name: 'Corte',
        unitIds: tenant.unitIds,
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
