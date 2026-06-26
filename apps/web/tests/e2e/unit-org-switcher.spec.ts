import { expect, test } from './fixtures'
import {
  pgQueryProjection,
  seedAdditionalOrg,
  setMembershipUnitId,
  signInAndAttachSession,
} from './helpers/session'

// Brief 0029 (#1051) — top context switcher + first-access interstitial +
// single-unit lock + org switch. Covers AC-03/AC-04/AC-05/AC-09.
//
// The switcher renders in the app-shell header on every operational surface,
// so its breadcrumb (`org > unidade`) is the cross-surface anchor for
// asserting the active context.

test.describe('Seletor de contexto (unidade + org)', () => {
  test.describe('gerente multi-unidade — interstitial no 1º acesso', () => {
    test.use({ orgInput: { unitCount: 3 } })

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

  test.describe('org de 1 unidade — entra direto, sem seletor', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('sem interstitial; switcher mostra o breadcrumb sem picker de unidade', async ({
      authedPage,
    }) => {
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      const switcher = authedPage.getByLabel('Contexto da unidade')
      await expect(switcher).toContainText('Unidade 1')
      // Single org + single unit → no interactive picker at all.
      await expect(switcher).toHaveAttribute('data-interactive', 'false')
    })
  })

  test.describe('membro travado em 1 unidade (membership.unitId)', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('sem interstitial, sem picker; preso na unidade definida', async ({ authedPage, org }) => {
      // Pin the member to the first unit (AC-05).
      await setMembershipUnitId(`${org.orgId}_${org.uid}`, org.unitIds[0]!)

      await authedPage.goto('/agenda')
      // Locked members never see the interstitial — they enter directly.
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const switcher = authedPage.getByLabel('Contexto da unidade')
      await expect(switcher).toContainText('Unidade 1')
      // No unit picker is offered (and with one org, no org picker
      // either) → static breadcrumb.
      await expect(switcher).toHaveAttribute('data-interactive', 'false')

      // Even hitting the interstitial directly bounces to the locked unit.
      await authedPage.goto('/select-unit')
      await expect(authedPage).toHaveURL(/\/agenda$/)
    })
  })

  test.describe('User com 2+ orgs — troca de org reseta a unidade', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('switcher de org aparece; trocar não vaza a unidade do org anterior', async ({
      authedPage,
      org,
      context,
      baseURL,
    }) => {
      // Give the seeded owner a second org with 2 units (AC-09).
      const second = await seedAdditionalOrg(org.uid, { name: 'Segundo Negócio', unitCount: 2 })

      // Re-attach the session so the layout re-reads memberships.
      await signInAndAttachSession(context, org.email, org.password, baseURL ?? undefined)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const switcher = authedPage.getByLabel('Contexto da unidade')
      // Two memberships → the switcher is interactive (org picker).
      await expect(switcher).toHaveAttribute('data-interactive', 'true')
      await expect(switcher).toContainText('Unidade 1')

      // Switch to the second org.
      await switcher.click()
      await authedPage.getByRole('menuitem', { name: 'Segundo Negócio' }).click()

      // currentOrgId moved to the new org, and its 2 units mean the
      // active-unit context reset → first-access interstitial fires (no leak
      // of the previous org's unit — AC-09).
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByText('Escolha a unidade')).toBeVisible()
      await expect(
        authedPage.getByRole('button', { name: 'Segundo Negócio Unidade 1' }),
      ).toBeVisible()

      // Persisted pointer reflects the switch.
      const [user] = await pgQueryProjection('users', 'uid', org.uid)
      expect(user?.current_org_id).toBe(second.orgId)

      // Pick a unit in the new org → enters scoped to it.
      await authedPage.getByRole('button', { name: 'Segundo Negócio Unidade 2' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(authedPage.getByLabel('Contexto da unidade')).toContainText('Segundo Negócio')
    })
  })
})
