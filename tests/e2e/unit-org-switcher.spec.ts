import { expect, test } from './fixtures'
import {
  pgQueryProjection,
  seedAdditionalOrg,
  setMembershipUnitId,
  signInAndAttachSession,
} from './helpers/session'

test.describe('Seletor de contexto (unidade + org)', () => {
  test.describe('gerente multi-unidade — interstitial no 1º acesso', () => {
    test.use({ orgInput: { unitCount: 3 } })

    test('1º acesso mostra interstitial, escolhe unidade, opera e troca pelo switcher', async ({
      authedPage,
    }) => {
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByText('Escolha a unidade')).toBeVisible()

      await authedPage.getByRole('button', { name: 'Unidade 2' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const switcher = authedPage.getByLabel('Contexto da unidade')
      await expect(switcher).toContainText('Unidade 2')
      await expect(switcher).toHaveAttribute('data-interactive', 'true')

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(authedPage.getByLabel('Contexto da unidade')).toContainText('Unidade 2')

      await switcher.click()
      const unit3Item = authedPage.getByRole('menuitem', { name: 'Unidade 3' })
      await expect(unit3Item).toBeVisible()
      await unit3Item.click()
      await expect(authedPage.getByLabel('Contexto da unidade')).toContainText('Unidade 3')

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
      await expect(switcher).toHaveAttribute('data-interactive', 'false')
    })
  })

  test.describe('membro travado em 1 unidade (membership.unitId)', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('sem interstitial, sem picker; preso na unidade definida', async ({ authedPage, org }) => {
      await setMembershipUnitId(`${org.orgId}_${org.uid}`, org.unitIds[0]!)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const switcher = authedPage.getByLabel('Contexto da unidade')
      await expect(switcher).toContainText('Unidade 1')
      await expect(switcher).toHaveAttribute('data-interactive', 'false')

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
      const second = await seedAdditionalOrg(org.uid, { name: 'Segundo Negócio', unitCount: 2 })

      await signInAndAttachSession(context, org.email, org.password, baseURL ?? undefined)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const switcher = authedPage.getByLabel('Contexto da unidade')
      await expect(switcher).toHaveAttribute('data-interactive', 'true')
      await expect(switcher).toContainText('Unidade 1')

      await switcher.click()
      await authedPage.getByRole('menuitem', { name: 'Segundo Negócio' }).click()

      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByText('Escolha a unidade')).toBeVisible()
      await expect(
        authedPage.getByRole('button', { name: 'Segundo Negócio Unidade 1' }),
      ).toBeVisible()

      const [user] = await pgQueryProjection('users', 'uid', org.uid)
      expect(user?.current_org_id).toBe(second.orgId)

      await authedPage.getByRole('button', { name: 'Segundo Negócio Unidade 2' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(authedPage.getByLabel('Contexto da unidade')).toContainText('Segundo Negócio')
    })
  })
})
