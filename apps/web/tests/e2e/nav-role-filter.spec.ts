import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { setMembershipRole } from './helpers/session'

// Brief 0029 (#1052) — AC-08: the sidebar nav is filtered by role via
// `canManageOrg`. A receptionist must not see the Administração section
// (Negócios / Unidades / Equipe) nor the financeiro-admin items
// (Relatórios); owner/manager see everything. PRD Identidade v2 / F5 renamed
// the old "Empresa" item to "Negócios". Brief 0031 (#1062)
// folded the cash report + commissions into the `/reports` hub, so the nav
// item is now "Relatórios" (no standalone "Caixa"/"Comissões").
//
// Assertions scope to the sidebar content region so unrelated links elsewhere
// on the page never produce false positives.

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

test.describe('Navegação filtrada por papel (AC-08)', () => {
  test.use({ orgInput: { unitCount: 1 } })

  test('owner vê todas as seções e itens financeiro-admin', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    const nav = sidebar(authedPage)
    // Every section label is present.
    await expect(nav.getByText('Operação', { exact: true })).toBeVisible()
    await expect(nav.getByText('Cadastros', { exact: true })).toBeVisible()
    await expect(nav.getByText('Administração', { exact: true })).toBeVisible()

    // Financeiro-admin items are visible (Comissões is folded into Relatórios).
    await expect(nav.getByRole('link', { name: 'Relatórios' })).toBeVisible()
    // Dashboard surfaces financeiro KPIs, so it's manager-only too.
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    // The old standalone Caixa/Comissões items are gone (brief 0031).
    await expect(nav.getByRole('link', { name: 'Caixa' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Comissões' })).toHaveCount(0)
    // Administração items are visible. The standalone "Unidades" entry was folded
    // into the single "Negócios" folder-manager (PRD Identidade v2); there is no
    // separate "Unidades" nav item anymore (see nav-items.test.ts).
    await expect(nav.getByRole('link', { name: 'Negócios' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Equipe' })).toBeVisible()

    // Sidebar is operational-only after brief 0090: Perfil, Privacidade and
    // "Plano e cobrança" moved to the Configurações modal (reached via the
    // UserMenu at the sidebar footer), so none of them are sidebar entries.
    await expect(nav.getByRole('link', { name: 'Perfil' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Privacidade' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Plano e cobrança' })).toHaveCount(0)
    await expect(nav.getByText('Conta', { exact: true })).toHaveCount(0)
  })

  test('UserMenu no rodapé abre Configurações (brief 0090, AC-02/03)', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await expect(authedPage).toHaveURL(/\/agenda$/)

    // The account menu lives in the sidebar footer, not the top bar. Its avatar
    // trigger opens the dropdown with the Configurações entry, which navigates to
    // the settings surface (default section Perfil).
    const footer = authedPage.locator('[data-sidebar="footer"]')
    await footer.getByRole('button', { name: 'Conta' }).click()
    await authedPage.getByRole('menuitem', { name: /Configurações/ }).click()

    // Lands on the settings surface (Perfil is the default section).
    await expect(authedPage).toHaveURL(/\/settings\/profile$/)
  })

  test('recepção não vê Administração nem Comissões', async ({ authedPage, org }) => {
    // Demote the seeded owner to receptionist (AC-08 base: canManageOrg).
    await setMembershipRole(`${org.orgId}_${org.uid}`, 'receptionist')

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

    // The whole Administração section disappears.
    await expect(nav.getByText('Administração', { exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Negócios', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Unidades', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Equipe' })).toHaveCount(0)

    // Financeiro-admin items inside Operação are hidden.
    await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)
  })
})
