import { expect, test } from '../fixtures'
import { chooseOptionByIndex } from '../helpers/select'
import { seedCustomer, seedSubscriptionPlan } from '../helpers/session'

test.describe('List-surface pattern — three states (#1072)', () => {
  test('no data → EmptyState protagonist, header CTA + filter tabs hidden', async ({
    authedPage,
  }) => {
    await authedPage.goto('/subscriptions')

    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()
    await expect(authedPage.getByRole('link', { name: 'Nova assinatura' })).toBeVisible()

    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeHidden()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toBeHidden()
  })

  test('with data → normal chrome; filtered-empty → filters stay + no-results', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const planLabel = `Plano LS ${ts}`
    await seedSubscriptionPlan(org.orgId, { name: planLabel })
    await seedCustomer(org.orgId)

    await authedPage.goto('/subscriptions/new')
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await expect(authedPage.getByText('Ativa', { exact: true }).first()).toBeVisible({
      timeout: 5000,
    })

    await authedPage.goto('/subscriptions?status=open')
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeVisible()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toHaveText('Em aberto')
    await expect(authedPage.getByText(planLabel)).toBeVisible({ timeout: 5000 })

    await authedPage.goto('/subscriptions?status=cancelled')
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeVisible()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toHaveText('Encerradas')
    await expect(authedPage.getByText(/nenhuma assinatura para/i)).toBeVisible()
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeHidden()
  })
})
