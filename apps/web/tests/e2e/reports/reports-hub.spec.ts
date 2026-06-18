// E2E spec — sub-issue #1062 do brief 0031, AC-05/06 [critical][smoke].
// Atualizado pelo brief 0044 (#1120): o agregado cross-unit foi removido — as
// seções leem só a unidade ativa, sem toggle "Todas as unidades".
//
// `/reports` é o hub: uma casca com as seções Vendas (por período) e Comissões
// (por membro). Ambas escopam pela unidade ativa do contexto. As rotas antigas
// `/cash/report` e `/reports/commissions` colapsam no hub. A nav ganha
// "Relatórios" (owner/manager) e perde "Caixa"/"Comissões".
//
// Roda contra emulator + build de produção (modo canônico do playwright.config).

import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { setMembershipRole } from '../helpers/session'

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

function uniqueSuffix(): string {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

function fsBaseUrl(): string {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

// Seeds a `sale` cash movement in a unit within the default (day) window, so it
// shows up in the Vendas section's movements table + sales-by-method totals.
function seedSaleMovement(orgId: string, unitId: string, amountCents: number): void {
  const id = `e2e-mov-${uniqueSuffix()}`
  const now = new Date().toISOString()
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `${fsBaseUrl()}/orgs/${orgId}/cash_movements/${id}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          id: { stringValue: id },
          orgId: { stringValue: orgId },
          unitId: { stringValue: unitId },
          kind: { stringValue: 'sale' },
          direction: { stringValue: 'in' },
          amountCents: { integerValue: String(amountCents) },
          paymentMethod: { stringValue: 'cash' },
          orderId: { stringValue: `order-${id}` },
          expenseCategoryId: { nullValue: null },
          description: { nullValue: null },
          recordedByUid: { stringValue: 'system' },
          createdAt: { stringValue: now },
        },
      }),
    ],
    { stdio: 'pipe' },
  )
}

test.describe('Hub /reports (#1062 · 0031 AC-05/06)', () => {
  test.describe('single-unit owner', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('hub renderiza seções Vendas + Comissões', async ({ org, authedPage }) => {
      seedSaleMovement(org.orgId, org.unitIds[0]!, 5000)

      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      // Seção Vendas (migrada de /cash/report) + seção Comissões (reusada de
      // /reports/commissions) na mesma casca.
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()
      // A venda seedada aparece na tabela de movimentos da seção Vendas.
      await expect(
        authedPage
          .getByRole('row')
          .filter({ hasText: 'Venda' })
          .filter({ hasText: /R\$\s*50,00/ }),
      ).toBeVisible()
    })

    test('baseline: hub sem dados abre com empty state claro', async ({ authedPage }) => {
      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      // Vendas vazio + Comissões vazio, sem ação fantasma nem erro.
      await expect(authedPage.getByText('Nenhuma venda no período.').first()).toBeVisible()
      await expect(authedPage.getByText('Nenhuma comissão no período.')).toBeVisible()
      await expect(authedPage.getByText('Nenhum atendimento coberto no período.')).toBeVisible()
    })

    test('rota antiga de comissões redireciona pro hub', async ({ authedPage }) => {
      await authedPage.goto('/reports/commissions')
      await expect(authedPage).toHaveURL(/\/reports$/)
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()
    })

    test('rotas /cash colapsam → redirecionam pro hub /reports', async ({ authedPage }) => {
      // Brief 0031 (AC-05): caixa colapsou no hub — as rotas legadas
      // `/cash`/`/cash/report` REDIRECIONAM graciosamente pro `/reports` (migração
      // de URL sem 404 em links antigos), igual a `/reports/commissions` acima.
      for (const route of ['/cash', '/cash/report']) {
        await authedPage.goto(route)
        await expect(authedPage).toHaveURL(/\/reports$/)
      }
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
    })

    test('nav: "Relatórios" presente; "Caixa"/"Comissões" ausentes', async ({ authedPage }) => {
      await authedPage.goto('/agenda')
      const nav = sidebar(authedPage)
      await expect(nav.getByRole('link', { name: 'Relatórios' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Caixa' })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Comissões' })).toHaveCount(0)
    })

    test('nav: recepção não vê "Relatórios" (requires manageOrg)', async ({ org, authedPage }) => {
      setMembershipRole(`${org.orgId}_${org.uid}`, 'receptionist')
      await authedPage.goto('/agenda')
      const nav = sidebar(authedPage)
      await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveCount(0)
      // A rota também é negada server-side (owner/manager apenas).
      await authedPage.goto('/reports')
      await expect(authedPage).toHaveURL(/\/agenda$/)
    })
  })

  // Brief 0044 (#1120): sem agregado cross-unit. O hub lê só a unidade ativa —
  // nenhum toggle "Todas as unidades" e `?units=all` é param morto (não agrega).
  test.describe('unidade ativa (sem agregado — 0044)', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('owner 2-unidades: sem toggle; ?units=all não agrega (param morto)', async ({
      org,
      authedPage,
    }) => {
      const [unitA, unitB] = org.unitIds
      // Vendas distintas por unidade: A = R$ 50,00, B = R$ 99,00.
      seedSaleMovement(org.orgId, unitA!, 5000)
      seedSaleMovement(org.orgId, unitB!, 9900)

      // Org 2-unidades sem unidade ativa → interstitial; escolhe A.
      await authedPage.goto('/reports')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)

      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      // Nenhum toggle de agregação.
      await expect(authedPage.getByRole('checkbox', { name: 'Todas as unidades' })).toHaveCount(0)
      // Só a venda da unidade ativa (A) aparece; a de B não.
      const aRow = authedPage
        .getByRole('row')
        .filter({ hasText: 'Venda' })
        .filter({ hasText: /R\$\s*50,00/ })
      const bRow = authedPage
        .getByRole('row')
        .filter({ hasText: 'Venda' })
        .filter({ hasText: /R\$\s*99,00/ })
      await expect(aRow).toBeVisible()
      await expect(bRow).toHaveCount(0)

      // Forçar `?units=all` não agrega: continua só na unidade ativa (A).
      await authedPage.goto('/reports?units=all')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Todas as unidades' })).toHaveCount(0)
      await expect(aRow).toBeVisible()
      await expect(bRow).toHaveCount(0)
    })
  })
})
