import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { setMembershipRole } from '../helpers/session'

// Configurações modal E2E (brief 0090 DoD — cenários 1, 2, 3). The settings
// surfaces (Perfil, Privacidade, Cobrança, Notificações) live behind a single
// UserMenu entry at the sidebar footer. The modal is a client dialog anchored to
// the URL hash `#settings/<section>` — NOT a route — so it survives a hard
// navigation (reload / tablet resume / a form refresh) instead of collapsing to
// a full page (bug #13). The `/settings/*` routes still exist and render the full
// page on a direct load / deep link (server-first — guard/RLS/LGPD intact).
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

    // Opens as a dialog on the Perfil section (default). The background path stays
    // /agenda; the open state lives in the hash.
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(authedPage).toHaveURL(/\/agenda#settings\/profile$/)
    await expect(dialog.getByRole('heading', { name: 'Meu perfil' })).toBeVisible()

    // The flat section nav is present with all four sections (owner).
    const nav = dialog.getByRole('navigation', { name: 'Seções de configuração' })
    for (const label of ['Perfil', 'Privacidade', 'Cobrança', 'Notificações']) {
      await expect(nav.getByRole('button', { name: label })).toBeVisible()
    }

    // Navigate to Cobrança — stays a dialog, hash + panel update, path unchanged.
    await nav.getByRole('button', { name: 'Cobrança' }).click()
    await expect(authedPage).toHaveURL(/\/agenda#settings\/billing$/)
    await expect(dialog.getByRole('heading', { name: 'Cobrança' })).toBeVisible()

    // Esc closes the modal and restores the background surface (/agenda), hash cleared.
    await authedPage.keyboard.press('Escape')
    await expect(authedPage.getByRole('dialog')).toHaveCount(0)
    await expect(authedPage).toHaveURL(/\/agenda$/)
  })

  test('reload com a modal aberta MANTÉM a modal (bug #13)', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await openConfiguracoes(authedPage)
    await expect(authedPage.getByRole('dialog')).toBeVisible()
    await expect(authedPage).toHaveURL(/#settings\/profile$/)

    // The crux of the fix: a hard reload keeps the hash, so the modal reopens on
    // the same section instead of falling back to a full page.
    await authedPage.reload()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Meu perfil' })).toBeVisible()
    await expect(authedPage).toHaveURL(/\/agenda#settings\/profile$/)
  })

  test('deep-link e refresh de /settings/* renderizam a página cheia (cenário 3)', async ({
    authedPage,
  }) => {
    // Direct navigation (hard load) to a settings ROUTE renders the full page —
    // no dialog, server-first (guard/RLS/LGPD intact). This path backs deep links
    // and LGPD e-mails.
    await authedPage.goto('/settings/privacy')
    await expect(authedPage.getByRole('dialog')).toHaveCount(0)
    await expect(authedPage.getByRole('heading', { name: 'Privacidade dos dados' })).toBeVisible()

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
    await expect(nav.getByRole('button', { name: 'Perfil' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Privacidade' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Cobrança' })).toHaveCount(0)
    await expect(nav.getByRole('button', { name: 'Notificações' })).toHaveCount(0)
  })
})
