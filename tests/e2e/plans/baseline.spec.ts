import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { seedCustomer, seedSubscription, seedSubscriptionPlan } from '../helpers/session'

test.describe('Plans — baseline (#17)', { tag: '@critical' }, () => {
  test('render + empty state', async ({ authedPage }) => {
    await authedPage.goto('/plans')
    await expect(authedPage.getByText('Nenhum plano cadastrado')).toBeVisible()
    await expect(authedPage.getByRole('link', { name: 'Cadastrar plano' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Planos de assinatura' })).toBeHidden()
  })

  test('criar pelo fluxo real → listar → editar → excluir', async ({ authedPage }) => {
    const ts = Date.now().toString()
    const name = `Plano Baseline ${ts}`
    const edited = `${name} Editado`

    await authedPage.goto('/plans/new')
    await authedPage.locator('input[name="name"]').fill(name)
    await authedPage.locator('input[name="priceCents"]').fill('99,90')
    await authedPage.locator('input[name="limitQuantity"]').fill('4')
    await authedPage.locator('form').getByRole('button', { name: 'Criar' }).click()
    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(authedPage).toHaveURL(/\/plans\/.+/)
    await authedPage.locator('input[name="name"]').fill(edited)
    await authedPage.locator('form').getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(edited, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, new RegExp(ts))).toBeHidden({
      timeout: 5000,
    })
  })

  test('dado degenerado (plano legado sem id/usageLimit) renderiza e exclui', async ({
    org,
    authedPage,
  }) => {
    await seedSubscriptionPlan(org.orgId, { name: 'Plano Legado', priceCents: 0 })

    await authedPage.goto('/plans')
    await expect(authedPage.getByRole('heading', { name: 'Planos de assinatura' })).toBeVisible()
    await expect(authedPage.getByText('Plano Legado')).toBeVisible()

    await rowAction(authedPage, /Plano Legado/, 'Excluir')
    await authedPage.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /Plano Legado/)).toBeHidden({
      timeout: 5000,
    })
  })

  test('em uso: 1 verbo "Excluir" vira soft-delete (some da ativa, vínculo segue)', async ({
    org,
    authedPage,
  }) => {
    const planId = await seedSubscriptionPlan(org.orgId, { name: 'Plano Em Uso' })
    const customerId = await seedCustomer(org.orgId, { name: 'Cliente Assinante' })
    await seedSubscription(org.orgId, customerId, { planId })

    await authedPage.goto('/plans')
    await expect(listItem(authedPage, /Plano Em Uso/)).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Arquivar' })).toHaveCount(0)
    await expect(authedPage.getByRole('menuitem', { name: 'Arquivar' })).toHaveCount(0)

    await rowAction(authedPage, /Plano Em Uso/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/fim do ciclo vigente/i)).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    await expect(listItem(authedPage, /Plano Em Uso/)).toBeHidden({
      timeout: 5000,
    })
  })

  test('livre: "Excluir" hard-delete remove de vez (sem assinaturas)', async ({
    org,
    authedPage,
  }) => {
    await seedSubscriptionPlan(org.orgId, { name: 'Plano Livre' })

    await authedPage.goto('/plans')
    await expect(listItem(authedPage, /Plano Livre/)).toBeVisible()

    await rowAction(authedPage, /Plano Livre/, 'Excluir')
    await authedPage.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /Plano Livre/)).toBeHidden({ timeout: 5000 })
  })
})
