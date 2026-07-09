import { expect, test } from '../fixtures'
import { enableUnitBusinessHours } from '../helpers/forms'
import { rowAction } from '../helpers/list'
import { enterUnitsAfterCreate } from '../helpers/session'
import { UnitsPage } from '../pages'

test.describe('Unidades — WhatsApp', () => {
  test.describe('CRUD com 1 unidade', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('WhatsApp cadastrado é editável na página de detalhe', async ({ authedPage }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoList()
      await rowAction(authedPage, /Unidade 1/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'WhatsApp' })).toHaveValue(
        '(11) 90000-0000',
      )
    })

    test('/units/new persiste WhatsApp normalizado e aparece na listagem', async ({
      authedPage,
    }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoNew()
      const dialog = authedPage.getByRole('dialog')
      await dialog.getByRole('textbox', { name: 'Nome' }).fill('Filial Centro')
      await dialog.getByRole('textbox', { name: 'WhatsApp' }).fill('11955554444')
      await dialog.getByRole('textbox', { name: 'Email' }).fill('centro@e2e.test')
      await dialog.getByRole('textbox', { name: 'CEP' }).fill('01310-100')
      await expect(dialog.getByText(/São Paulo\/SP/)).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Número' }).fill('200')
      await enableUnitBusinessHours(dialog)
      await dialog.getByRole('button', { name: 'Criar' }).click()

      await enterUnitsAfterCreate(authedPage)
      await rowAction(authedPage, /Filial Centro/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'WhatsApp' })).toHaveValue(
        '(11) 95555-4444',
      )
    })

    test('/units/new bloqueia o submit enquanto o WhatsApp não normaliza', async ({
      authedPage,
    }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoNew()
      const dialog = authedPage.getByRole('dialog')
      await dialog.getByRole('textbox', { name: 'Nome' }).fill('Filial Bad WA')
      const whatsapp = dialog.getByRole('textbox', { name: 'WhatsApp' })
      await whatsapp.fill('abc')
      await dialog.getByRole('textbox', { name: 'CEP' }).fill('01310-100')
      await expect(dialog.getByText(/São Paulo\/SP/)).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Número' }).fill('200')

      await expect(whatsapp).toHaveValue('')
      await expect(dialog.getByRole('button', { name: 'Criar' })).toBeDisabled()
      await expect(authedPage.getByRole('dialog')).toBeVisible()
    })
  })
})
