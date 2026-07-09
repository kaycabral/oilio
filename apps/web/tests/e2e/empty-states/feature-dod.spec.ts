import { expect, test } from '../fixtures'
import { chooseOptionByIndex } from '../helpers/select'
import { seedCustomer, seedSubscriptionPlan } from '../helpers/session'

test.describe('Empty-state protagonista — Feature DoD (brief 0034 · #1071)', () => {
  test('Cenário 1 — lista sem dados é protagonista (esconde header + filtros)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/subscriptions')

    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()
    await expect(authedPage.getByRole('link', { name: 'Nova assinatura' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeHidden()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toBeHidden()
    await expect(authedPage.getByRole('searchbox')).toBeHidden()

    await authedPage.goto('/customers')
    await expect(authedPage.getByText('Nenhum cliente cadastrado')).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Clientes' })).toBeHidden()
  })

  test('Cenário 4 — sem superfície interativa prematura no vazio (1 CTA só)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()

    const surface = authedPage.locator('[data-slot="empty-state"]')
    await expect(surface).toBeVisible()
    await expect(surface.getByRole('link')).toHaveCount(1)
    await expect(surface.getByRole('button')).toHaveCount(0)
  })

  test('Cenários 2 + 3 + Baseline — fluxo real: vazio → criar → chrome normal → filtrado-vazio', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const planLabel = `Plano DoD ${ts}`
    await seedSubscriptionPlan(org.orgId, { name: planLabel })
    await seedCustomer(org.orgId)

    await authedPage.goto('/subscriptions')
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()

    await authedPage.getByRole('link', { name: 'Nova assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/new$/)
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
