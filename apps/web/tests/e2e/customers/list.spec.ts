// Feature E2E — the customers page renders the shared `<List>` from
// `@cbrl/design` (design-system listing adoption). Covers the populated state:
// one row per customer with name + contact, and the per-row overflow (⋯) menu
// holding the Ver (read-only detail link) + Excluir actions. The customer fills
// their own data now (#1279), so the establishment only views — never edits.
// Runs against the emulator (no mocks).

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

    // Both customers render as rows.
    await expect(authedPage.getByText('Maria Silva')).toBeVisible()
    await expect(authedPage.getByText('João Souza')).toBeVisible()

    // The exposed WhatsApp shortcut links to wa.me for the customer.
    const wa = authedPage.getByRole('link', { name: 'WhatsApp de Maria Silva' })
    await expect(wa).toHaveAttribute('href', /wa\.me\//)

    // Other actions live behind the per-row ⋯ menu.
    await authedPage.getByRole('button', { name: 'Ações de Maria Silva' }).click()

    const viewItem = authedPage.getByRole('menuitem', { name: 'Ver' })
    await expect(viewItem).toBeVisible()
    await expect(viewItem).toHaveAttribute('href', /\/customers\/e2e-cust-/)
    await expect(authedPage.getByRole('menuitem', { name: 'Excluir' })).toBeVisible()
  })
})
