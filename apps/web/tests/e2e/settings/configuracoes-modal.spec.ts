import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { setMembershipRole } from '../helpers/session'

// Configurações modal E2E (brief 0090 DoD — cenários 1, 2, 3). The settings
// surfaces (Perfil, Privacidade, Cobrança, Notificações) live behind a single
// UserMenu entry at the sidebar footer. Each section is a real /settings/* route
// intercepted as a 2-column dialog on client navigation; a direct load / refresh
// renders the full page (server-first — guard/RLS/LGPD intact).
//
// The seeded member is the owner by default (fixtures), so the full section nav
// (incl. Cobrança + Notificações) is available; the gate case demotes to
// receptionist.

const openConfiguracoes = async (page: Page) => {
  const footer = page.locator('[data-sidebar="footer"]')
  await footer.getByRole('button', { name: 'Conta' }).click()
  await page.getByRole('menuitem', { name: /Configurações/ }).click()
}

test.describe('Configurações modal (brief 0090)', { tag: '@critical' }, () => {
  test('abre pela UserMenu na seção Perfil e navega entre as seções (cenário 1)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/agenda')

    await openConfiguracoes(authedPage)

    // Opens as a dialog on the Perfil section (default) — URL reflects the route.
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(authedPage).toHaveURL(/\/settings\/profile$/)
    await expect(dialog.getByRole('heading', { name: 'Meu perfil' })).toBeVisible()

    // The flat section nav is present with all four sections (owner).
    const nav = dialog.getByRole('navigation', { name: 'Seções de configuração' })
    for (const label of ['Perfil', 'Privacidade', 'Cobrança', 'Notificações']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible()
    }

    // Navigate to Cobrança — stays a dialog, URL + panel update.
    await nav.getByRole('link', { name: 'Cobrança' }).click()
    await expect(authedPage).toHaveURL(/\/settings\/billing$/)
    await expect(dialog.getByRole('heading', { name: 'Cobrança' })).toBeVisible()

    // Esc closes the modal and restores the background surface (/agenda).
    await authedPage.keyboard.press('Escape')
    await expect(authedPage.getByRole('dialog')).toHaveCount(0)
    await expect(authedPage).toHaveURL(/\/agenda$/)
  })

  test('back fecha o dialog sem sair do app (cenário 1)', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await openConfiguracoes(authedPage)
    await expect(authedPage.getByRole('dialog')).toBeVisible()

    await authedPage.goBack()
    await expect(authedPage.getByRole('dialog')).toHaveCount(0)
    await expect(authedPage).toHaveURL(/\/agenda$/)
  })

  test('deep-link e refresh renderizam a página cheia, não o dialog (cenário 3)', async ({
    authedPage,
  }) => {
    // Direct navigation (hard load) to a settings route renders the full page —
    // no dialog, server-first (guard/RLS/LGPD intact).
    await authedPage.goto('/settings/privacy')
    await expect(authedPage.getByRole('dialog')).toHaveCount(0)
    await expect(authedPage.getByRole('heading', { name: 'Privacidade dos dados' })).toBeVisible()

    // Refresh keeps it a full page (the @modal slot falls back to default→null).
    await authedPage.reload()
    await expect(authedPage.getByRole('dialog')).toHaveCount(0)
    await expect(authedPage.getByRole('heading', { name: 'Privacidade dos dados' })).toBeVisible()
  })

  test('receptionist não vê Cobrança/Notificações no nav da modal (cenário 2 — gate)', async ({
    authedPage,
    org,
  }) => {
    await setMembershipRole(`${org.orgId}_${org.uid}`, 'receptionist')

    await authedPage.goto('/agenda')
    await openConfiguracoes(authedPage)

    const dialog = authedPage.getByRole('dialog')
    const nav = dialog.getByRole('navigation', { name: 'Seções de configuração' })
    // Personal sections remain; management-only ones are hidden from the nav.
    await expect(nav.getByRole('link', { name: 'Perfil' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Privacidade' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Cobrança' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Notificações' })).toHaveCount(0)
  })
})
