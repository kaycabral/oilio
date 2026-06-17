import { expect, test } from './fixtures'
import { stringValueOf } from './helpers/firestore-rest'
import {
  readUser,
  seedAdditionalTenant,
  setMembershipUnitId,
  signInAndAttachSession,
} from './helpers/session'

// Brief 0029 (#1051) — top context switcher + first-access interstitial +
// single-unit lock + tenant switch. Covers AC-03/AC-04/AC-05/AC-09.
//
// The switcher renders in the app-shell header on every operational surface,
// so its breadcrumb (`tenant > unidade`) is the cross-surface anchor for
// asserting the active context.

test.describe('Seletor de contexto (unidade + tenant)', () => {
  test.describe('gerente multi-unidade — interstitial no 1º acesso', () => {
    test.use({ tenantInput: { unitCount: 3 } })

    test('1º acesso mostra interstitial, escolhe unidade, opera e troca pelo switcher', async ({
      authedPage,
    }) => {
      // First access: no active-unit cookie + 3 units → the (app) layout
      // redirects to the interstitial (AC-04).
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByText('Escolha a unidade')).toBeVisible()

      // Pick the second unit → enters the app scoped to it.
      await authedPage.getByRole('button', { name: 'Unidade 2' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)

      // The header switcher reflects the chosen unit (AC-03).
      const switcher = authedPage.getByLabel('Contexto da unidade')
      await expect(switcher).toContainText('Unidade 2')
      await expect(switcher).toHaveAttribute('data-interactive', 'true')

      // Going back to /agenda no longer interstitials — the cookie sticks.
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(authedPage.getByLabel('Contexto da unidade')).toContainText('Unidade 2')

      // Switch unit via the top switcher → context changes (AC-03).
      await switcher.click()
      const unit3Item = authedPage.getByRole('menuitem', { name: 'Unidade 3' })
      await expect(unit3Item).toBeVisible()
      await unit3Item.click()
      await expect(authedPage.getByLabel('Contexto da unidade')).toContainText('Unidade 3')

      // The shared context is now the single source of unit — per-feature unit
      // controls were removed (brief 0039, AC-01); no agenda <select> mirrors it.
      await expect(authedPage.getByLabel('Unidade ativa')).toHaveCount(0)
    })
  })

  test.describe('tenant de 1 unidade — entra direto, sem seletor', () => {
    test.use({ tenantInput: { unitCount: 1 } })

    test('sem interstitial; switcher mostra o breadcrumb sem picker de unidade', async ({
      authedPage,
    }) => {
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      const switcher = authedPage.getByLabel('Contexto da unidade')
      await expect(switcher).toContainText('Unidade 1')
      // Single tenant + single unit → no interactive picker at all.
      await expect(switcher).toHaveAttribute('data-interactive', 'false')
    })
  })

  test.describe('membro travado em 1 unidade (membership.unitId)', () => {
    test.use({ tenantInput: { unitCount: 2 } })

    test('sem interstitial, sem picker; preso na unidade definida', async ({
      authedPage,
      tenant,
    }) => {
      // Pin the member to the first unit (AC-05).
      setMembershipUnitId(`${tenant.tenantId}_${tenant.uid}`, tenant.unitIds[0]!)

      await authedPage.goto('/agenda')
      // Locked members never see the interstitial — they enter directly.
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const switcher = authedPage.getByLabel('Contexto da unidade')
      await expect(switcher).toContainText('Unidade 1')
      // No unit picker is offered (and with one tenant, no tenant picker
      // either) → static breadcrumb.
      await expect(switcher).toHaveAttribute('data-interactive', 'false')

      // Even hitting the interstitial directly bounces to the locked unit.
      await authedPage.goto('/select-unit')
      await expect(authedPage).toHaveURL(/\/agenda$/)
    })
  })

  test.describe('User com 2+ tenants — troca de tenant reseta a unidade', () => {
    test.use({ tenantInput: { unitCount: 1 } })

    test('switcher de tenant aparece; trocar não vaza a unidade do tenant anterior', async ({
      authedPage,
      tenant,
      context,
      baseURL,
    }) => {
      // Give the seeded owner a second tenant with 2 units (AC-09).
      const second = seedAdditionalTenant(tenant.uid, { name: 'Segundo Negócio', unitCount: 2 })

      // Re-attach the session so the layout re-reads memberships.
      await signInAndAttachSession(context, tenant.email, tenant.password, baseURL ?? undefined)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const switcher = authedPage.getByLabel('Contexto da unidade')
      // Two memberships → the switcher is interactive (tenant picker).
      await expect(switcher).toHaveAttribute('data-interactive', 'true')
      await expect(switcher).toContainText('Unidade 1')

      // Switch to the second tenant.
      await switcher.click()
      await authedPage.getByRole('menuitem', { name: 'Segundo Negócio' }).click()

      // currentTenantId moved to the new tenant, and its 2 units mean the
      // active-unit context reset → first-access interstitial fires (no leak
      // of the previous tenant's unit — AC-09).
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByText('Escolha a unidade')).toBeVisible()
      await expect(
        authedPage.getByRole('button', { name: 'Segundo Negócio Unidade 1' }),
      ).toBeVisible()

      // Persisted pointer reflects the switch.
      const user = readUser(tenant.uid)
      expect(stringValueOf(user?.currentTenantId)).toBe(second.tenantId)

      // Pick a unit in the new tenant → enters scoped to it.
      await authedPage.getByRole('button', { name: 'Segundo Negócio Unidade 2' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(authedPage.getByLabel('Contexto da unidade')).toContainText('Segundo Negócio')
    })
  })
})
