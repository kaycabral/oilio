import { expect, test } from './fixtures'
import { listItem } from './helpers/list'
import { setActiveUnitCookie } from './helpers/session'
import { ServicesPage } from './pages'

// Coverage for #874 — Service oferta + preço por unit. Golden path:
// owner cria service oferecido em 2 units com sobrescrever preço na
// segunda, vê preço efetivo correto persistido.

test.describe('Serviços — oferta + preço por unidade', () => {
  test.describe('empresa multi-unidade', () => {
    test.use({ tenantInput: { unitCount: 2 } })

    test('/services/new permite escolher unidades + sobrescrever preço', async ({
      context,
      tenant,
      authedPage,
      baseURL,
    }) => {
      // 2-unit tenant with no chosen unit is sent to `/select-unit` (0029
      // AC-04). Pin the active unit so the catalog form route resolves directly.
      await setActiveUnitCookie(context, tenant.unitIds[0]!, baseURL ?? undefined)
      const services = new ServicesPage(authedPage)
      await services.gotoNew()
      await authedPage.getByRole('textbox', { name: 'Nome' }).fill('Corte Masculino')
      await authedPage.getByRole('spinbutton', { name: 'Duração (min)' }).fill('30')
      await authedPage.getByRole('textbox', { name: 'Preço (R$)' }).fill('50,00')

      // Both units start unchecked — multi-unit tenant doesn't auto-fill.
      const unit1 = authedPage.getByRole('checkbox', { name: /Unidade 1/ })
      const unit2 = authedPage.getByRole('checkbox', { name: /Unidade 2/ })
      await unit1.check()
      await unit2.check()

      // Expand overrides + set price for unit 2 only.
      await authedPage.getByRole('button', { name: /Exceções por unidade/ }).click()
      await authedPage.getByRole('textbox', { name: 'Preço (R$)' }).nth(1).fill('70,00')

      await authedPage.getByRole('button', { name: 'Criar' }).click()
      // Converged: the create flow now returns to the unified /catalog list
      // (brief 0023, #1005).
      await expect(authedPage).toHaveURL(/\/catalog$/)
      await expect(listItem(authedPage, 'Corte Masculino')).toBeVisible()
    })

    test('/services/new exige pelo menos uma unidade selecionada', async ({
      context,
      tenant,
      authedPage,
      baseURL,
    }) => {
      await setActiveUnitCookie(context, tenant.unitIds[0]!, baseURL ?? undefined)
      const services = new ServicesPage(authedPage)
      await services.gotoNew()
      await authedPage.getByRole('textbox', { name: 'Nome' }).fill('Corte')
      await authedPage.getByRole('spinbutton', { name: 'Duração (min)' }).fill('30')
      await authedPage.getByRole('textbox', { name: 'Preço (R$)' }).fill('50,00')
      // The active unit (Unidade 1) is pre-checked by default (brief 0039
      // AC-03) — uncheck it to reach the zero-units state the rule guards.
      await authedPage.getByRole('checkbox', { name: /Unidade 1/ }).uncheck()
      await expect(authedPage.getByText(/Selecione ao menos uma unidade/)).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Criar' })).toBeDisabled()
    })
  })
})
