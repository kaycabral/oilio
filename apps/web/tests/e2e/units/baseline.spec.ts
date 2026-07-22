import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { createUnitViaWizard } from '../helpers/forms'
import { listItem, rowAction } from '../helpers/list'
import { enterUnitsAfterCreate, seedUnit } from '../helpers/session'

async function dismissUnitInterstitialIfPresent(page: Page): Promise<void> {
  await enterUnitsAfterCreate(page)
}

test.describe('Units — baseline (#17)', () => {
  test.describe('empty org', () => {
    test.use({ orgInput: { unitCount: 0 } })

    test('render + empty state (/units → /organizations)', async ({ authedPage }) => {
      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
      await expect(
        authedPage.getByText('Nenhuma unidade ainda. Crie a primeira para começar a atender.'),
      ).toBeVisible()
    })
  })

  test('criar pelo fluxo real → listar → editar → excluir', async ({ authedPage }) => {
    await authedPage.route('**/api/postal-code/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          postalCode: '01310100',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Bela Vista',
          street: 'Avenida Paulista',
        }),
      }),
    )
    const ts = Date.now().toString()
    const name = `Unidade Baseline ${ts}`
    const edited = `${name} Editada`

    await authedPage.goto('/organizations')
    await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
    const createDialog = authedPage.getByRole('dialog')
    await expect(createDialog.getByText('Passo 1 de 4')).toBeVisible()
    await createUnitViaWizard(createDialog, {
      name,
      username: `un-${ts.slice(-9)}`,
      whatsapp: `119${ts.slice(-8)}`,
      number: '123',
    })
    await dismissUnitInterstitialIfPresent(authedPage)
    await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(authedPage).toHaveURL(/\/units\/.+/)
    await authedPage.getByRole('textbox', { name: 'Nome' }).fill(edited)
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await dismissUnitInterstitialIfPresent(authedPage)
    await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
    await expect(authedPage.getByText(edited, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Excluir')
    const delDialog = authedPage.getByRole('alertdialog')
    await delDialog.getByRole('textbox').fill(edited)
    await delDialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, new RegExp(ts))).toBeHidden({
      timeout: 5000,
    })
  })

  test('unidade mínima (sem endereço/horário configurados) renderiza e exclui', async ({
    org,
    authedPage,
  }) => {
    await seedUnit(org.orgId, { name: 'Unidade Legada' })

    await authedPage.goto('/units')
    await dismissUnitInterstitialIfPresent(authedPage)
    await expect(authedPage.getByRole('heading', { name: 'Negócios' })).toBeVisible()
    await expect(authedPage.getByText('Unidade Legada')).toBeVisible()

    await rowAction(authedPage, /Unidade Legada/, 'Excluir')
    const legadaDialog = authedPage.getByRole('alertdialog')
    await legadaDialog.getByRole('textbox').fill('Unidade Legada')
    await legadaDialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /Unidade Legada/)).toBeHidden({
      timeout: 5000,
    })
  })

  test('em uso: 1 verbo "Excluir" vira soft-delete (some da ativa)', async ({ authedPage }) => {
    await authedPage.goto('/units')
    await expect(listItem(authedPage, /Unidade 1/)).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Arquivar' })).toHaveCount(0)
    await expect(authedPage.getByRole('menuitem', { name: 'Arquivar' })).toHaveCount(0)

    await rowAction(authedPage, /Unidade 1/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/profissional ativo ou agendamento futuro/i)).toBeVisible()
    await dialog.getByRole('textbox').fill('Unidade 1')
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    await expect(listItem(authedPage, /Unidade 1/)).toBeHidden({ timeout: 5000 })
  })

  test('livre: "Excluir" hard-delete remove de vez (sem referências)', async ({ authedPage }) => {
    await authedPage.route('**/api/postal-code/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          postalCode: '01310100',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Bela Vista',
          street: 'Avenida Paulista',
        }),
      }),
    )
    const ts = Date.now().toString()
    const name = `Unidade Livre ${ts}`
    await authedPage.goto('/organizations')
    await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
    const createDialog = authedPage.getByRole('dialog')
    await createUnitViaWizard(createDialog, {
      name,
      username: `liv-${ts.slice(-9)}`,
      whatsapp: `119${ts.slice(-8)}`,
      number: '123',
    })
    await dismissUnitInterstitialIfPresent(authedPage)
    await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Excluir')
    const livreDialog = authedPage.getByRole('alertdialog')
    await livreDialog.getByRole('textbox').fill(name)
    await livreDialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, new RegExp(ts))).toBeHidden({
      timeout: 5000,
    })
  })
})
