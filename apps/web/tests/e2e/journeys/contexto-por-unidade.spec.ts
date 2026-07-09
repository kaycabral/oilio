import { membershipDocId } from '@/domain'
import { MembershipConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { type Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { twoUnits } from '../helpers/rest-json'
import {
  pgQueryProjection,
  pgReadProjection,
  seedAdditionalOrg,
  seedService,
  setMembershipRole,
  setMembershipUnitId,
  signInAndAttachSession,
} from '../helpers/session'

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')
const switcher = (page: Page) => page.getByLabel('Contexto da unidade')

test.describe('Contexto por unidade e navegação — DoD (#1049 · 0029)', () => {
  test.describe('Cenário 1 — gerente multi-unidade troca contexto', () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('1º acesso interstitial → unidade escolhida escopa Agenda/Comandas/Bloqueios/Dashboard; switcher troca tudo junto', async ({
      authedPage,
      org,
    }) => {
      const membership = await pgReadProjection(
        'memberships',
        aggregateRef(MembershipConfig, org.orgId, membershipDocId(org.orgId, org.uid)),
      )
      expect(membership).not.toBeNull()
      expect(membership?.rls_unit_scope).toBeNull()

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await expect(authedPage.getByText('Escolha a unidade')).toBeVisible()

      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      await authedPage.goto('/orders')
      await expect(authedPage.getByText('Nenhuma venda registrada')).toBeVisible()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      await authedPage.goto('/dashboard')
      await expect(authedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      await switcher(authedPage).click()
      await authedPage.getByRole('menuitem', { name: 'Unidade 2' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 2')

      await authedPage.goto('/agenda')
      await expect(switcher(authedPage)).toContainText('Unidade 2')
      await authedPage.goto('/orders')
      await expect(switcher(authedPage)).toContainText('Unidade 2')
    })
  })

  test.describe('Cenário 2 — membro single-unit travado', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('membership.unitId trava na unidade: sem interstitial, sem picker, sem alcançar outra', async ({
      authedPage,
      org,
    }) => {
      const [unit1] = twoUnits(org.unitIds)
      const membershipId = membershipDocId(org.orgId, org.uid)
      await setMembershipUnitId(membershipId, unit1)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      await expect(switcher(authedPage)).toHaveAttribute('data-interactive', 'false')

      await authedPage.goto('/select-unit')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(switcher(authedPage)).toContainText('Unidade 1')
    })
  })

  test.describe('Cenário 3 — cadastro e relatório seguem cross-unit', () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('com contexto numa unidade, Catálogo/Planos/Relatórios continuam mostrando todas as unidades', async ({
      authedPage,
      org,
    }) => {
      const [unit1, unit2] = twoUnits(org.unitIds)

      const serviceId = await seedService(org.orgId, {
        name: 'Corte Cross-Unit',
        publicVisible: true,
        unitIds: [unit1, unit2],
        unitOverrides: { [unit2]: { priceCents: 7000 } },
      })

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      await authedPage.goto(`/catalog/${serviceId}`)
      await expect(authedPage.getByRole('heading', { name: 'Editar item' })).toBeVisible()
      const offered = authedPage.getByRole('group', { name: 'Onde é oferecido', exact: true })
      await expect(offered.getByText('Unidade 1')).toBeVisible()
      await expect(offered.getByText('Unidade 2')).toBeVisible()
      const unitChecks = offered.locator('input[name="unitIds"]')
      await expect(unitChecks).toHaveCount(2)
      await expect(offered.locator(`input[name="unitIds"][value="${unit1}"]`)).toBeChecked()
      await expect(offered.locator(`input[name="unitIds"][value="${unit2}"]`)).toBeChecked()

      await authedPage.goto('/plans')
      await expect(authedPage.getByText('Nenhum plano cadastrado')).toBeVisible()

      await authedPage.goto('/reports')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      await authedPage.goto('/agenda')
      await expect(switcher(authedPage)).toContainText('Unidade 1')
    })
  })

  test.describe('Cenário 4 — navegação por papel', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('recepção: sem Administração nem Comissões; mantém Operação + Clientes', async ({
      authedPage,
      org,
    }) => {
      await setMembershipRole(membershipDocId(org.orgId, org.uid), 'receptionist')

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)

      const nav = sidebar(authedPage)
      await expect(nav.getByText('Operação', { exact: true })).toBeVisible()
      await expect(nav.getByText('Cadastros', { exact: true })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Agenda' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Vendas' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Clientes' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Catálogo' })).toHaveCount(0)

      await expect(nav.getByText('Administração', { exact: true })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Negócios & Unidades' })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Unidades', exact: true })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Equipe' })).toHaveCount(0)

      await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Comissões' })).toHaveCount(0)
    })
  })

  test.describe('Cenário 5 — troca de org reseta contexto', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('trocar de org pelo switcher reseta a unidade ativa pro novo org (sem vazar a anterior)', async ({
      authedPage,
      org,
      context,
      baseURL,
    }) => {
      const second = await seedAdditionalOrg(org.uid, { name: 'Segundo Negócio', unitCount: 2 })

      await signInAndAttachSession(context, org.email, org.password, baseURL ?? undefined)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda$/)
      await expect(switcher(authedPage)).toHaveAttribute('data-interactive', 'true')
      await expect(switcher(authedPage)).toContainText('Unidade 1')

      await switcher(authedPage).click()
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
      await expect(switcher(authedPage)).toContainText('Segundo Negócio')
    })
  })

  test.describe('Baseline — org sem unidade → surfaces sem gate', () => {
    test.use({ orgInput: { unitCount: 0 } })

    test('sem unidade: dono cross-unit acessa as surfaces (sem interstitial, sem gate)', async ({
      authedPage,
    }) => {
      await authedPage.goto('/orders')
      await expect(authedPage).toHaveURL(/\/orders(\/|\?|$)/)
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expect(authedPage).not.toHaveURL(/\/select-unit(\/|$)/)

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/orders(\/|\?|$)/)
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expect(authedPage).not.toHaveURL(/\/select-unit(\/|$)/)
    })
  })
})
