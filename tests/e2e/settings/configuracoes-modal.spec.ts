import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { setMembershipRole } from '../helpers/session'

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

    const dialog = authedPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(authedPage).toHaveURL(/\/agenda#settings\/profile$/)
    await expect(dialog.getByRole('heading', { name: 'Perfil' })).toBeVisible()

    const nav = dialog.getByRole('navigation', { name: 'Seções de configuração' })
    for (const label of ['Perfil', 'Cobrança', 'Notificações', 'Privacidade']) {
      await expect(nav.getByRole('button', { name: label })).toBeVisible()
    }

    await nav.getByRole('button', { name: 'Cobrança' }).click()
    await expect(authedPage).toHaveURL(/\/agenda#settings\/billing$/)
    await expect(dialog.getByRole('heading', { name: 'Cobrança' })).toBeVisible()

    await authedPage.keyboard.press('Escape')
    await expect(authedPage.getByRole('dialog')).toHaveCount(0)
    await expect(authedPage).toHaveURL(/\/agenda$/)
  })

  test('reload com a modal aberta MANTÉM a modal (bug #13)', async ({ authedPage }) => {
    await authedPage.goto('/agenda')
    await openConfiguracoes(authedPage)
    await expect(authedPage.getByRole('dialog')).toBeVisible()
    await expect(authedPage).toHaveURL(/#settings\/profile$/)

    await authedPage.reload()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Perfil' })).toBeVisible()
    await expect(authedPage).toHaveURL(/\/agenda#settings\/profile$/)
  })

  test('deep-link e refresh de /settings/* renderizam a página cheia (cenário 3)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/settings/privacy')
    await expect(authedPage.getByRole('dialog')).toHaveCount(0)
    await expect(authedPage.getByRole('heading', { name: 'Privacidade' })).toBeVisible()

    await authedPage.reload()
    await expect(authedPage.getByRole('dialog')).toHaveCount(0)
    await expect(authedPage.getByRole('heading', { name: 'Privacidade' })).toBeVisible()
  })

  test('o retorno do checkout reabre a modal na aba Cobrança (#1376)', async ({ authedPage }) => {
    await authedPage.goto('/agenda#settings/billing')

    const dialog = authedPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Cobrança' })).toBeVisible()
    await expect(authedPage).toHaveURL(/\/agenda#settings\/billing$/)
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
    await expect(nav.getByRole('button', { name: 'Perfil' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Privacidade' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Cobrança' })).toHaveCount(0)
    await expect(nav.getByRole('button', { name: 'Notificações' })).toHaveCount(0)
  })
})
