import { expect, test } from '../fixtures'
import { enableUnitBusinessHours } from '../helpers/forms'
import { rowAction } from '../helpers/list'
import { enterUnitsAfterCreate, setActiveUnitCookie } from '../helpers/session'
import { UnitsPage } from '../pages'

test.describe('Unidades — slug público', () => {
  test.describe('CRUD com 1 unidade', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('slug da unidade cadastrada é editável na página de detalhe', async ({ authedPage }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoList()
      await rowAction(authedPage, /Unidade 1/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'Slug público' })).toHaveValue(
        'unidade-1',
      )
    })

    test('/units/new auto-deriva slug do nome e persiste', async ({ authedPage }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoNew()
      const dialog = authedPage.getByRole('dialog')
      await dialog.getByRole('textbox', { name: 'Nome' }).fill('Filial Centro Velho')
      await expect(dialog.getByRole('textbox', { name: 'Slug público' })).toHaveValue(
        'filial-centro-velho',
      )
      await expect(dialog.getByText(/disponível/i)).toBeVisible()

      await expect(dialog.getByRole('textbox', { name: 'Slug público' })).toHaveAttribute(
        'pattern',
        '[a-z0-9](?:[a-z0-9\\-]*[a-z0-9])?',
      )

      await dialog.getByRole('textbox', { name: 'WhatsApp' }).fill('11955554444')
      await dialog.getByRole('textbox', { name: 'CEP' }).fill('01310-100')
      await expect(dialog.getByText(/São Paulo\/SP/)).toBeVisible()

      await expect(dialog.getByRole('button', { name: 'Criar' })).toBeDisabled()
      await expect(dialog.getByText(/Preencha .*Número.* para criar/i)).toBeVisible()

      await dialog.getByRole('textbox', { name: 'Número' }).fill('200')
      await expect(dialog.getByText(/Preencha .*Número.* para criar/i)).toHaveCount(0)
      await enableUnitBusinessHours(dialog)
      await dialog.getByRole('button', { name: 'Criar' }).click()

      await enterUnitsAfterCreate(authedPage)
      await rowAction(authedPage, /Filial Centro Velho/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'Slug público' })).toHaveValue(
        'filial-centro-velho',
      )
    })
  })

  test.describe('CRUD com 2 unidades (colisão)', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('/units/[id] mostra erro de colisão quando slug é de outra unidade', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      const firstUnitId = org.unitIds[0]!
      await setActiveUnitCookie(context, firstUnitId, baseURL ?? undefined)
      const units = new UnitsPage(authedPage)
      await units.gotoById(firstUnitId)
      const slugInput = authedPage.getByRole('textbox', { name: 'Slug público' })
      await slugInput.fill('unidade-2')
      await expect(authedPage.getByText(/já em uso por outra unidade/i)).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Salvar' })).toBeDisabled()

      await slugInput.fill('unidade-renomeada')
      await expect(authedPage.getByText(/disponível/i)).toBeVisible()
      await expect(authedPage.getByText(/já em uso por outra unidade/i)).toHaveCount(0)
    })
  })
})
