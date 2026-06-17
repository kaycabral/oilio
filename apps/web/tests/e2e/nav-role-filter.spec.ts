import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { setMembershipRole } from './helpers/session'

// Brief 0029 (#1052) — AC-08: the sidebar nav is filtered by role via
// `canManageTenant`. A receptionist must not see the Configuração section
// (Unidades/Equipe/Empresa) nor the financeiro-admin items
// (Relatórios); owner/manager see everything. Brief 0031 (#1062)
// folded the cash report + commissions into the `/reports` hub, so the nav
// item is now "Relatórios" (no standalone "Caixa"/"Comissões").
//
// Assertions scope to the sidebar content region so unrelated links elsewhere
// on the page never produce false positives.

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

test.describe('Navegação filtrada por papel (AC-08)', () => {
  test.use({ tenantInput: { unitCount: 1 } })

  test('owner vê todas as seções e itens financeiro-admin', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    const nav = sidebar(authedPage)
    // Every section label is present.
    await expect(nav.getByText('Operação', { exact: true })).toBeVisible()
    await expect(nav.getByText('Cadastros', { exact: true })).toBeVisible()
    await expect(nav.getByText('Configuração', { exact: true })).toBeVisible()

    // Financeiro-admin items are visible (Comissões is folded into Relatórios).
    await expect(nav.getByRole('link', { name: 'Relatórios' })).toBeVisible()
    // The old standalone Caixa/Comissões items are gone (brief 0031).
    await expect(nav.getByRole('link', { name: 'Caixa' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Comissões' })).toHaveCount(0)
    // Configuração items are visible.
    await expect(nav.getByRole('link', { name: 'Unidades' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Equipe' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Empresa' })).toBeVisible()
  })

  test('recepção não vê Configuração nem Comissões', async ({ authedPage, tenant }) => {
    // Demote the seeded owner to receptionist (AC-08 base: canManageTenant).
    setMembershipRole(`${tenant.tenantId}_${tenant.uid}`, 'receptionist')

    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    const nav = sidebar(authedPage)
    // Operação + Cadastros remain (with the non-admin items).
    await expect(nav.getByText('Operação', { exact: true })).toBeVisible()
    await expect(nav.getByText('Cadastros', { exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Agenda' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Vendas' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Clientes' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Catálogo' })).toBeVisible()

    // The whole Configuração section disappears.
    await expect(nav.getByText('Configuração', { exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Unidades' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Equipe' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Empresa' })).toHaveCount(0)

    // Financeiro-admin items inside Operação are hidden.
    await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveCount(0)
  })
})
