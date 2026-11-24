import { expect, test } from '../fixtures'
import { setMembershipRole } from '../helpers/session'

test.describe('Cobrança — cancelamento nativo (brief 0090)', { tag: '@critical' }, () => {
  test.describe('owner com assinatura paga', () => {
    test.use({ orgInput: { tier: 'pro' } })

    test('vê a zona de cancelamento e o dialog destrutivo com a copy de retenção', async ({
      authedPage,
    }) => {
      await authedPage.goto('/settings/billing')

      await expect(authedPage.getByText('Cancelamento', { exact: true })).toBeVisible()
      await authedPage.getByRole('button', { name: 'Cancelar plano' }).click()

      const dialog = authedPage.getByRole('alertdialog')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(/Você ainda poderá usar o Plano Pro/)
      await expect(dialog).toContainText(/Você perderá acesso a/)
      await expect(dialog.getByRole('button', { name: 'Manter meu Plano Pro' })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Cancelar plano' })).toBeVisible()

      await dialog.getByRole('button', { name: 'Manter meu Plano Pro' }).click()
      await expect(authedPage.getByRole('alertdialog')).toHaveCount(0)
    })
  })

  test('não-owner (manager) não vê a ação de cancelamento', async ({ authedPage, org }) => {
    await setMembershipRole(`${org.orgId}_${org.uid}`, 'manager')

    await authedPage.goto('/settings/billing')
    await expect(authedPage.getByRole('heading', { name: 'Cobrança' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Cancelamento' })).toHaveCount(0)
    await expect(authedPage.getByRole('button', { name: 'Cancelar plano' })).toHaveCount(0)
  })
})
