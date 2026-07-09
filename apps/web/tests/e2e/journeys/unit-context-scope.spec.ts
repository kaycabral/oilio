import { expect, test } from '../fixtures'
import {
  seedOpenOrder as centralSeedOpenOrder,
  seedBlock,
  seedCatalogItem,
  seedCustomer,
  setActiveUnitCookie,
  type SeededOrg,
} from '../helpers/session'

async function seedOpenOrder(
  org: SeededOrg,
  unitId: string,
  customerId: string,
  totalCents: number,
): Promise<string> {
  return centralSeedOpenOrder({
    orgId: org.orgId,
    unitId,
    customerId,
    attributedUserId: org.uid,
    totalCents,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  })
}

test.describe('Active-unit operating context (#1050)', { tag: '@critical' }, () => {
  test.describe('multi-unit org scopes operational surfaces', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('Comandas + Bloqueios + Dashboard scope to the active unit and switch with the cookie', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      const [unitA, unitB] = org.unitIds
      expect(unitA).toBeTruthy()
      expect(unitB).toBeTruthy()

      const custA = await seedCustomer(org.orgId, { name: 'Cliente Unidade A' })
      const custB = await seedCustomer(org.orgId, { name: 'Cliente Unidade B' })
      await seedOpenOrder(org, unitA!, custA, 11100)
      await seedOpenOrder(org, unitB!, custB, 22200)

      await seedBlock({
        kind: 'recurring',
        orgId: org.orgId,
        unitId: unitA!,
        weekday: 'monday',
        open: '12:00',
        close: '13:00',
        reason: 'Almoco Unidade A',
      })
      await seedBlock({
        kind: 'recurring',
        orgId: org.orgId,
        unitId: unitB!,
        weekday: 'monday',
        open: '12:00',
        close: '13:00',
        reason: 'Almoco Unidade B',
      })

      await setActiveUnitCookie(context, unitA!, baseURL ?? undefined)

      await authedPage.goto('/orders?status=all')
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
      await expect(authedPage.getByText('Cliente Unidade A')).toBeVisible()
      await expect(authedPage.getByText('Cliente Unidade B')).toBeHidden()

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 222,00')).toBeHidden()

      await setActiveUnitCookie(context, unitB!, baseURL ?? undefined)

      await authedPage.goto('/orders?status=all')
      await expect(authedPage.getByText('Cliente Unidade B')).toBeVisible()
      await expect(authedPage.getByText('Cliente Unidade A')).toBeHidden()

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByText('R$ 222,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeHidden()
    })

    test('Catálogo stays cross-unit regardless of the active unit (AC-06)', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      const [unitA, unitB] = org.unitIds
      await seedCatalogItem(org.orgId, { name: 'Servico So Unidade A', unitIds: [unitA!] })
      await seedCatalogItem(org.orgId, { name: 'Servico So Unidade B', unitIds: [unitB!] })

      await setActiveUnitCookie(context, unitA!, baseURL ?? undefined)
      await authedPage.goto('/catalog')
      await expect(authedPage.getByRole('heading', { name: 'Catálogo' })).toBeVisible()
      await expect(authedPage.getByText('Servico So Unidade A')).toBeVisible()
      await expect(authedPage.getByText('Servico So Unidade B')).toBeVisible()

      await setActiveUnitCookie(context, unitB!, baseURL ?? undefined)
      await authedPage.goto('/catalog')
      await expect(authedPage.getByText('Servico So Unidade A')).toBeVisible()
      await expect(authedPage.getByText('Servico So Unidade B')).toBeVisible()
    })
  })

  test.describe('baseline — single-unit org', () => {
    test('enters directly, no per-feature unit picker on the agenda', async ({ authedPage }) => {
      await authedPage.goto('/agenda')
      await expect(authedPage.getByRole('heading', { name: 'Agenda' })).toBeVisible()
      await expect(authedPage.getByRole('combobox', { name: 'Unidade ativa' })).toHaveCount(0)
      await expect(authedPage.getByLabel('Contexto da unidade')).toHaveAttribute(
        'data-interactive',
        'false',
      )
    })
  })

  test.describe('baseline — zero-unit org', () => {
    test.use({ orgInput: { unitCount: 0, memberOperationCount: 0 } })

    test('owner com 0 unidades acessa as surfaces sem gate de onboarding', async ({
      authedPage,
    }) => {
      await authedPage.goto('/orders')
      await expect(authedPage).toHaveURL(/\/orders(\/|\?|$)/)
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expect(authedPage).not.toHaveURL(/\/select-unit(\/|$)/)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/orders(\/|\?|$)/)
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
    })
  })
})
