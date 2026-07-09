import { expect, test } from '../fixtures'
import { seedCustomer, uniqueWhatsapp } from '../helpers/session'

test.describe('Listagem de clientes (@cbrl/design List)', () => {
  test('renders rows and exposes Ver/Excluir in the ⋯ menu', async ({ org, authedPage }) => {
    await seedCustomer(org.orgId, { name: 'Maria Silva', mobile: uniqueWhatsapp() })
    await seedCustomer(org.orgId, {
      name: 'João Souza',
      mobile: uniqueWhatsapp(),
      avatarUrl: 'https://example.com/joao.png',
    })

    await authedPage.goto('/customers')

    await expect(authedPage.getByRole('heading', { name: 'Clientes' })).toBeVisible()

    await expect(authedPage.getByText('Maria Silva')).toBeVisible()
    await expect(authedPage.getByText('João Souza')).toBeVisible()

    const wa = authedPage.getByRole('link', { name: 'WhatsApp de Maria Silva' })
    await expect(wa).toHaveAttribute('href', /wa\.me\//)

    await authedPage.getByRole('button', { name: 'Ações de Maria Silva' }).click()

    const viewItem = authedPage.getByRole('menuitem', { name: 'Ver' })
    await expect(viewItem).toBeVisible()
    await expect(viewItem).toHaveAttribute('href', /\/customers\/e2e-cust-/)
    await expect(authedPage.getByRole('menuitem', { name: 'Excluir' })).toBeVisible()
  })
})
