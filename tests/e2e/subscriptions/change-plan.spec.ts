import { expect, test } from '../fixtures'
import { chooseOption, chooseOptionByIndex } from '../helpers/select'
import { seedCustomer, seedSubscriptionPlan } from '../helpers/session'

test.describe('Subscriptions — troca de plano (AC-07)', { tag: '@critical' }, () => {
  test('editar plano não retroage no assinante + nota de UX; trocar plano move', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const planA = `Plano A ${ts}`
    const planB = `Plano B ${ts}`
    const planAId = await seedSubscriptionPlan(org.orgId, { name: planA, priceCents: 10000 })
    await seedSubscriptionPlan(org.orgId, { name: planB, priceCents: 25000 })
    await seedCustomer(org.orgId)

    await authedPage.goto('/subscriptions/new')
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await chooseOption(authedPage, 'Plano', new RegExp(planA))
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/(?!new)[^/]+$/, { timeout: 10000 })
    const subUrl = authedPage.url()
    await expect(authedPage.getByRole('group', { name: 'Plano atual', exact: true })).toContainText(
      planA,
      {
        timeout: 5000,
      },
    )

    await authedPage.goto(`/plans/${planAId}`)
    await expect(authedPage.getByText(/Alterações valem só para novas assinaturas/)).toBeVisible()
    const planARenamed = `${planA} EDITADO`
    await authedPage.locator('input[name="name"]').fill(planARenamed)
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/plans(\?.*)?$/, { timeout: 10000 })

    await authedPage.goto(subUrl)
    const summary = authedPage.getByRole('group', { name: 'Plano atual', exact: true })
    await expect(summary).toContainText(planA, { timeout: 5000 })
    await expect(summary).not.toContainText('EDITADO')

    await chooseOption(authedPage, 'Plano de destino', new RegExp(planB))
    await authedPage.getByRole('button', { name: 'Trocar plano' }).click()

    await expect(summary).toContainText(planB, { timeout: 10000 })
    await expect(summary).toContainText('250,00')
  })
})
