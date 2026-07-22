import { expect, test } from '../fixtures'
import { createUnitViaWizard } from '../helpers/forms'
import { rowAction } from '../helpers/list'
import { enterUnitsAfterCreate, setActiveUnitCookie } from '../helpers/session'
import { UnitsPage } from '../pages'

test.describe('Unidades — @/nome de usuário', () => {
  test.describe('CRUD com 1 unidade', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('@ da unidade cadastrada é editável na página de detalhe', async ({ authedPage }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoList()
      await rowAction(authedPage, /Unidade 1/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'Nome de usuário' })).toHaveValue(
        'unidade-1',
      )
    })

    test('wizard auto-deriva o @ do nome, mostra preview do link e persiste', async ({
      authedPage,
    }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoNew()
      const dialog = authedPage.getByRole('dialog')
      await dialog.getByRole('textbox', { name: /^Nome\*?$/ }).fill('Filial Centro Velho')
      const username = dialog.getByRole('textbox', { name: 'Nome de usuário' })
      await expect(username).toHaveValue('filial-centro-velho')
      await expect(dialog.getByText(/disponível/i)).toBeVisible()
      await expect(dialog.getByText(/\/filial-centro-velho$/)).toBeVisible()

      await expect(username).toHaveAttribute('pattern', '[a-z0-9](?:[a-z0-9\\-]*[a-z0-9])?')

      await createUnitViaWizard(dialog, {
        name: 'Filial Centro Velho',
        whatsapp: '11955554444',
      })

      await enterUnitsAfterCreate(authedPage)
      await rowAction(authedPage, /Filial Centro Velho/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'Nome de usuário' })).toHaveValue(
        'filial-centro-velho',
      )
    })

    test('wizard trava o Continuar do passo Identidade com @ inválido', async ({ authedPage }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoNew()
      const dialog = authedPage.getByRole('dialog')
      await dialog.getByRole('textbox', { name: /^Nome\*?$/ }).fill('Filial Inválida')
      await dialog.getByRole('textbox', { name: 'WhatsApp' }).fill('11955554444')
      const username = dialog.getByRole('textbox', { name: 'Nome de usuário' })
      await username.click()
      await username.fill('ab')
      await expect(dialog.getByText(/@ inválido/i)).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Continuar' })).toBeDisabled()
    })
  })

  test.describe('CRUD com 2 unidades (colisão)', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('/units/[id] mostra erro de colisão quando o @ é de outra unidade', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      const firstUnitId = org.unitIds[0]!
      await setActiveUnitCookie(context, firstUnitId, baseURL ?? undefined)
      const units = new UnitsPage(authedPage)
      await units.gotoById(firstUnitId)
      const usernameInput = authedPage.getByRole('textbox', { name: 'Nome de usuário' })
      await usernameInput.fill('unidade-2')
      await expect(authedPage.getByText(/já está em uso por outra unidade/i)).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Salvar' })).toBeDisabled()

      await usernameInput.fill('unidade-renomeada')
      await expect(authedPage.getByText(/disponível/i)).toBeVisible()
      await expect(authedPage.getByText(/já está em uso por outra unidade/i)).toHaveCount(0)
    })
  })
})
