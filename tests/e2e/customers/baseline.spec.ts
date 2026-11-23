import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { seedCustomer, seedCustomerShadowForUser, uniqueWhatsapp } from '../helpers/session'

async function seedDegenerateCustomer(orgId: string): Promise<string> {
  const missingUserId = `e2e-missing-user-${Math.random().toString(36).slice(2)}`
  return await seedCustomerShadowForUser(orgId, missingUserId)
}

test.describe('Customers — baseline (#17)', () => {
  test('render + empty state', async ({ authedPage }) => {
    await authedPage.goto('/customers')
    await expect(authedPage.getByText('Nenhum cliente cadastrado')).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Convidar cliente' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Clientes' })).toBeHidden()
  })

  test('convidar pelo fluxo real gera link contextual (sem digitar PII do cliente)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/customers')
    await authedPage.getByRole('button', { name: 'Convidar cliente' }).click()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Convidar cliente' })).toBeVisible()
    await dialog.locator('input[name="whatsapp"]').fill(`119${Date.now().toString().slice(-8)}`)
    await expect(dialog.getByRole('textbox', { name: 'Link do convite' })).toHaveValue(/\/signup\?/)
    await expect(dialog.getByRole('button', { name: /abrir no whatsapp/i })).toBeVisible()
  })

  test('listar → ver → excluir (cliente materializado)', async ({ org, authedPage }) => {
    await seedCustomer(org.orgId, {
      name: 'Cliente Baseline',
      mobile: uniqueWhatsapp(),
    })

    await authedPage.goto('/customers')
    await expect(authedPage.getByText('Cliente Baseline')).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, /Cliente Baseline/, 'Ver')
    await expect(authedPage).toHaveURL(/\/customers\/.+/)
    await expect(authedPage.getByRole('heading', { name: 'Cliente Baseline' })).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Salvar' })).toBeHidden()
    await authedPage.goto('/customers')

    await rowAction(authedPage, /Cliente Baseline/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await dialog.getByRole('textbox').fill('Cliente Baseline')
    await dialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /Cliente Baseline/)).toBeHidden({
      timeout: 5000,
    })
  })

  test('dado degenerado (cliente avulso sem user/tags/id) renderiza e exclui', async ({
    org,
    authedPage,
  }) => {
    await seedDegenerateCustomer(org.orgId)

    await authedPage.goto('/customers')
    await expect(authedPage.getByRole('heading', { name: 'Clientes' })).toBeVisible()
    await expect(authedPage.getByText('(usuário não encontrado)')).toBeVisible()

    await rowAction(authedPage, /usuário não encontrado/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await dialog.getByRole('textbox').fill('(usuário não encontrado)')
    await dialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /usuário não encontrado/)).toBeHidden({
      timeout: 5000,
    })
  })
})
