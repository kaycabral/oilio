import { expect, test } from './fixtures'
import { listItem } from './helpers/list'
import { setActiveUnitCookie } from './helpers/session'
import { ServicesPage } from './pages'

test.describe('Serviços — oferta + preço por unidade', () => {
  test.describe('empresa multi-unidade', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('/services/new permite escolher unidades + sobrescrever preço', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      await setActiveUnitCookie(context, org.unitIds[0]!, baseURL ?? undefined)
      const services = new ServicesPage(authedPage)
      await services.gotoNew()
      await authedPage.getByRole('textbox', { name: 'Nome' }).fill('Corte Masculino')
      await authedPage.getByRole('spinbutton', { name: 'Duração (min)' }).fill('30')
      await authedPage.getByRole('textbox', { name: 'Preço (R$)' }).fill('50,00')

      const unit1 = authedPage.getByRole('checkbox', { name: /Unidade 1/ })
      const unit2 = authedPage.getByRole('checkbox', { name: /Unidade 2/ })
      await unit1.check()
      await unit2.check()

      await authedPage.getByRole('button', { name: /Exceções por unidade/ }).click()
      await authedPage.getByRole('textbox', { name: 'Preço (R$)' }).nth(1).fill('70,00')

      await authedPage.getByRole('button', { name: 'Criar' }).click()
      await expect(authedPage).toHaveURL(/\/catalog$/)
      await expect(listItem(authedPage, 'Corte Masculino')).toBeVisible()
    })

    test('/services/new exige pelo menos uma unidade selecionada', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      await setActiveUnitCookie(context, org.unitIds[0]!, baseURL ?? undefined)
      const services = new ServicesPage(authedPage)
      await services.gotoNew()
      await authedPage.getByRole('textbox', { name: 'Nome' }).fill('Corte')
      await authedPage.getByRole('spinbutton', { name: 'Duração (min)' }).fill('30')
      await authedPage.getByRole('textbox', { name: 'Preço (R$)' }).fill('50,00')
      await authedPage.getByRole('checkbox', { name: /Unidade 1/ }).uncheck()
      await expect(authedPage.getByText(/Selecione ao menos uma unidade/)).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Criar' })).toBeDisabled()
    })
  })
})
