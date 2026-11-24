import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { setMembershipRole } from './helpers/session'

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

test.describe('Navegação filtrada por papel (AC-08)', () => {
  test.use({ orgInput: { unitCount: 1 } })

  test('owner vê todas as seções e itens financeiro-admin', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    const nav = sidebar(authedPage)
    await expect(nav.getByText('Operação', { exact: true })).toBeVisible()
    await expect(nav.getByText('Cadastros', { exact: true })).toBeVisible()
    await expect(nav.getByText('Administração', { exact: true })).toBeVisible()

    await expect(nav.getByRole('link', { name: 'Relatórios' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Caixa' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Comissões' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Negócios' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Equipe' })).toBeVisible()

    await expect(nav.getByRole('link', { name: 'Perfil' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Privacidade' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Plano e cobrança' })).toHaveCount(0)
    await expect(nav.getByText('Conta', { exact: true })).toHaveCount(0)
  })

  test('UserMenu no rodapé abre Configurações (brief 0090, AC-02/03)', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    const footer = authedPage.locator('[data-sidebar="footer"]')
    await footer.getByRole('button', { name: 'Conta' }).click()
    await authedPage.getByRole('menuitem', { name: /Configurações/ }).click()

    await expect(authedPage.getByRole('dialog')).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Perfil' })).toBeVisible()
    await expect(authedPage).toHaveURL(/\/agenda#settings\/profile$/)
  })

  test('recepção não vê Administração nem Comissões', async ({ authedPage, org }) => {
    await setMembershipRole(`${org.orgId}_${org.uid}`, 'receptionist')

    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    const nav = sidebar(authedPage)
    await expect(nav.getByText('Operação', { exact: true })).toBeVisible()
    await expect(nav.getByText('Cadastros', { exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Agenda' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Vendas' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Clientes' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Catálogo' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Planos' })).toHaveCount(0)

    await expect(nav.getByText('Administração', { exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Negócios', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Unidades', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Equipe' })).toHaveCount(0)

    await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)
  })
})
