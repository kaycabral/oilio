import { membershipDocId } from '@/domain'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { createUnitViaWizard } from '../helpers/forms'
import { listItem } from '../helpers/list'
import { oneUnit, twoUnits } from '../helpers/rest-json'
import {
  seedClosedOrder as centralSeedClosedOrder,
  seedOpenOrder as centralSeedOpenOrder,
  seedCustomer,
  setActiveUnitCookie,
  setMembershipRole,
  setMembershipUnitId,
  type SeededOrg,
} from '../helpers/session'
import { MemberOperationsPage } from '../pages'

const switcher = (page: Page) => page.getByLabel('Contexto da unidade')

function revenueCard(page: Page): Locator {
  return page
    .locator('div')
    .filter({ hasText: /^Faturamento/ })
    .last()
}

async function seedClosedOrder(org: SeededOrg, unitId: string, totalCents: number): Promise<void> {
  await centralSeedClosedOrder({
    orgId: org.orgId,
    unitId,
    customerId: null,
    attributedUserId: org.uid,
    totalCents,
  })
}

async function seedStaleOpenOrder(
  org: SeededOrg,
  unitId: string,
  customerId: string,
  totalCents: number,
): Promise<void> {
  await centralSeedOpenOrder({
    orgId: org.orgId,
    unitId,
    customerId,
    attributedUserId: org.uid,
    totalCents,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  })
}

test.describe('Conformar app ao contexto de unidade — DoD (#1088 · 0039)', () => {
  test.describe('Cenário 1 — operação segue a unidade ativa, sem switcher por-feature', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('Dashboard/Notificações mostram a unidade ativa, sem filtro próprio; trocar no topo reflete em todas', async ({
      org,
      authedPage,
    }) => {
      const [unitA, unitB] = twoUnits(org.unitIds)

      const custA = await seedCustomer(org.orgId, { name: 'Cliente Unidade A' })
      const custB = await seedCustomer(org.orgId, { name: 'Cliente Unidade B' })
      await seedStaleOpenOrder(org, unitA, custA, 11100)
      await seedStaleOpenOrder(org, unitB, custB, 22200)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 222,00')).toBeHidden()
      await expect(authedPage.getByRole('combobox', { name: 'Unidade' })).toHaveCount(0)

      await authedPage.goto('/notifications')
      await expect(authedPage.getByRole('heading', { name: 'Notificações' })).toBeVisible()
      const notificationsMain = authedPage.locator('main.p-6')
      await expect(
        notificationsMain.getByRole('button', { name: 'Unidade 1', exact: true }),
      ).toHaveCount(0)
      await expect(
        notificationsMain.getByRole('button', { name: 'Unidade 2', exact: true }),
      ).toHaveCount(0)

      await switcher(authedPage).click()
      await authedPage.getByRole('menuitem', { name: 'Unidade 2' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 2')

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByText('R$ 222,00')).toBeVisible()
      await expect(authedPage.getByText('R$ 111,00')).toBeHidden()
    })
  })

  test.describe('Cenário 2 — definição default na ativa, multi-select preservado', () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('novo item pré-marca a unidade ativa (multi-select preservado); editar profissional mantém a seleção atual', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      const [unitOne, unitTwo] = twoUnits(org.unitIds)

      await setActiveUnitCookie(context, unitTwo, baseURL ?? undefined)

      await authedPage.goto('/catalog/new')
      await expect(authedPage.getByRole('heading', { name: 'Novo item' })).toBeVisible()
      const offered = authedPage.getByRole('group', { name: 'Onde é oferecido', exact: true })
      const unitBox = (id: string) =>
        offered
          .locator('label')
          .filter({ has: authedPage.locator(`input[name="unitIds"][value="${id}"]`) })
          .getByRole('checkbox')
      const newUnitOne = unitBox(unitOne)
      const newUnitTwo = unitBox(unitTwo)
      await expect(newUnitTwo).toBeChecked()
      await expect(newUnitOne).not.toBeChecked()
      await newUnitOne.check()
      await expect(newUnitOne).toBeChecked()
      await expect(newUnitTwo).toBeChecked()

      const proUid = `e2e-prof-user-${org.memberOperationIds[0]}`
      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoByUserId(proUid)
      const unitsGroup = authedPage.getByRole('group', { name: 'Unidades', exact: true })
      await expect(unitsGroup.locator(`input[name="unitIds"][value="${unitOne}"]`)).toBeChecked()
      await expect(unitsGroup.locator(`input[name="unitIds"][value="${unitTwo}"]`)).toBeChecked()
    })
  })

  test.describe('Cenário 3 — tudo na unidade ativa, sem agregado', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('dashboard escopa só na unidade ativa; sem toggle e ?units=all não agrega', async ({
      org,
      authedPage,
    }) => {
      const [unitA, unitB] = twoUnits(org.unitIds)
      await seedClosedOrder(org, unitA, 10000)
      await seedClosedOrder(org, unitB, 25000)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Todas as unidades' })).toHaveCount(0)
      await expect(revenueCard(authedPage).getByText('R$ 100,00')).toBeVisible()
      await expect(revenueCard(authedPage).getByText('R$ 350,00')).toBeHidden()

      await authedPage.goto('/dashboard?units=all')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Todas as unidades' })).toHaveCount(0)
      await expect(revenueCard(authedPage).getByText('R$ 100,00')).toBeVisible()
      await expect(revenueCard(authedPage).getByText('R$ 350,00')).toBeHidden()

      await switcher(authedPage).click()
      await authedPage.getByRole('menuitem', { name: 'Unidade 2' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 2')
      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(revenueCard(authedPage).getByText('R$ 250,00')).toBeVisible()
      await expect(revenueCard(authedPage).getByText('R$ 350,00')).toBeHidden()
    })
  })

  test.describe('Cenário 4 — `/units` gated a quem opera cross-unit', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('dono gere /units e cria 2ª unidade; gerente vinculado a uma unidade é redirecionado pra /agenda', async ({
      org,
      authedPage,
    }) => {
      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
      await expect(authedPage.getByRole('heading', { name: 'Negócios' })).toBeVisible()

      await authedPage.getByRole('button', { name: '+ Nova unidade' }).click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Nome' }).fill('Filial Centro Velho')
      await expect(dialog.getByRole('textbox', { name: 'Nome de usuário' })).toHaveValue(
        'filial-centro-velho',
      )
      await expect(dialog.getByText(/disponível/i)).toBeVisible()
      await createUnitViaWizard(dialog, {
        name: 'Filial Centro Velho',
        whatsapp: '11955554444',
      })

      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByRole('button', { name: 'Filial Centro Velho' })).toBeVisible()
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
      await expect(listItem(authedPage, /Filial Centro Velho/)).toBeVisible()

      const membershipId = membershipDocId(org.orgId, org.uid)
      const [unit1] = oneUnit(org.unitIds)
      await setMembershipRole(membershipId, 'manager')
      await setMembershipUnitId(membershipId, unit1)

      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await authedPage.goto('/units/new')
      await expect(authedPage).toHaveURL(/\/agenda$/)
    })
  })

  test.describe('Baseline — org 1 unidade sem seletor; membro unit-bound sem agregado/units', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('1 unidade: switcher não interativo, sem agregado; recepção não acessa /units (redirect)', async ({
      org,
      authedPage,
    }) => {
      const membershipId = membershipDocId(org.orgId, org.uid)
      await setMembershipRole(membershipId, 'receptionist')

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(switcher(authedPage)).toContainText('Unidade 1')
      await expect(switcher(authedPage)).toHaveAttribute('data-interactive', 'false')

      await authedPage.goto('/dashboard')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/agenda$/)
    })
  })
})
