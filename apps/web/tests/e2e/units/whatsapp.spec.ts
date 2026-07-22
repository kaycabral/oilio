import { expect, test } from '../fixtures'
import { createUnitViaWizard } from '../helpers/forms'
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
      await createUnitViaWizard(dialog, {
        name: 'Filial Centro',
        whatsapp: '11955554444',
        email: 'centro@e2e.test',
      })

      await enterUnitsAfterCreate(authedPage)
      await rowAction(authedPage, /Filial Centro/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'WhatsApp' })).toHaveValue(
        '(11) 95555-4444',
      )
    })

    test('wizard bloqueia o avanço enquanto o WhatsApp não normaliza', async ({ authedPage }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoNew()
      const dialog = authedPage.getByRole('dialog')
      await dialog.getByRole('textbox', { name: /^Nome\*?$/ }).fill('Filial Bad WA')
      const whatsapp = dialog.getByRole('textbox', { name: 'WhatsApp' })
      await whatsapp.fill('abc')

      await expect(whatsapp).toHaveValue('')
      await expect(dialog.getByRole('button', { name: 'Continuar' })).toBeDisabled()
      await expect(authedPage.getByRole('dialog')).toBeVisible()
    })
  })
})
