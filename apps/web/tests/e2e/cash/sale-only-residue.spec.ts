// Regression E2E — brief 0031 (remover resíduo de caixa), sub-issue #1060.
//
// Guardrail crítico do brief: o registro financeiro AUTOMÁTICO da venda
// (`sale` no fechamento, `sale_reversal` no undo) NÃO pode regredir quando a
// gaveta manual sai. E a superfície manual (AddMovementForm /
// sangria/suprimento / /cash/categories) tem que estar GONE.
//
// Roda contra emulator + build de produção (modo canônico do playwright.config).

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { rowAction } from '../helpers/list'
import { choosePaymentMethod } from '../helpers/select'
import { seedAppointment, seedCustomer, seedService, type SeededOrg } from '../helpers/session'
import { AgendaPage } from '../pages'

// Brief 0031 (#1062): `/cash` colapsou no hub `/reports`. O registro automático
// da venda (`sale`/`sale_reversal`) agora é lido na seção Vendas do hub. As
// linhas da venda aparecem na tabela de movimentos (não mais numa lista).
const salesRow = (page: Page, label: string | RegExp) =>
  page.getByRole('row').filter({ hasText: label })

async function seedOrderFixture(org: SeededOrg): Promise<void> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Residuo',
    whatsapp: '11955554444',
  })
  await seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    professionalId: org.professionalIds[0]!,
    customerId,
    serviceId,
    startAt: '2026-09-08T17:00:00.000Z',
    endAt: '2026-09-08T17:30:00.000Z',
    status: 'scheduled',
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: { kind: 'percentage', value: 50 },
  })
}

async function startOrder(authedPage: Page): Promise<void> {
  const agenda = new AgendaPage(authedPage)
  await agenda.goto('2026-09-08')
  await authedPage.getByRole('button', { name: /Cliente Residuo/ }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
}

async function closeWithCash(authedPage: Page): Promise<void> {
  await choosePaymentMethod(authedPage, 'cash')
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
}

test.describe('Caixa 0031 — só venda automática, gaveta removida', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('guardrail: fechamento grava `sale`, undo grava `sale_reversal`', async ({
    org,
    authedPage,
  }) => {
    await seedOrderFixture(org)

    // Fecha com dinheiro → registra a venda (sem depender de gaveta).
    await startOrder(authedPage)
    await closeWithCash(authedPage)
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    // A venda aparece na seção Vendas do hub `/reports` (mês cobre a data
    // futura seedada). A linha mostra Tipo "Venda" + valor +R$ 50,00.
    await authedPage.goto('/reports?period=month')
    await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
    const saleRow = salesRow(authedPage, 'Venda').filter({ hasText: /\+\s*R\$\s*50,00/ })
    await expect(saleRow).toBeVisible()

    // Desfaz → `sale_reversal` coexiste com a venda (append-only). A order foi
    // fechada, então vive sob o filtro "Fechadas" (default de /orders é abertas).
    await authedPage.goto('/orders?status=closed')
    // Orders rows are List items; open the detail via the ⋯ menu ("Ver detalhes"),
    // which links to /orders/{id} (rows are no longer plain links).
    await rowAction(authedPage, /Cliente Residuo/, 'Ver detalhes')
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await authedPage.getByRole('button', { name: /Desfazer fechamento/ }).click()
    await expect(authedPage.getByText(/Aberta em/)).toBeVisible({ timeout: 5000 })

    // "Venda" é substring de "Estorno de venda"; distinguimos pelo sinal do
    // valor (+ entrada vs. − estorno) pra evitar strict-mode violation com as
    // duas linhas presentes (append-only: a venda nunca some).
    await authedPage.goto('/reports?period=month')
    await expect(
      salesRow(authedPage, 'Venda').filter({ hasText: /\+\s*R\$\s*50,00/ }),
    ).toBeVisible()
    await expect(
      salesRow(authedPage, 'Estorno de venda').filter({ hasText: /−\s*R\$\s*50,00/ }),
    ).toBeVisible()
  })

  test('gaveta manual e categorias removidas da UI', async ({ authedPage }) => {
    // `/cash` colapsou no hub: a rota redireciona pra `/reports`.
    await authedPage.goto('/cash')
    await expect(authedPage).toHaveURL(/\/reports$/)
    await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()

    // Sem form de registro manual nem seletor de tipo de movimento.
    await expect(authedPage.getByRole('button', { name: 'Registrar movimento' })).toHaveCount(0)
    await expect(authedPage.getByRole('combobox', { name: 'Tipo' })).toHaveCount(0)

    // Rota de categorias de despesa não existe mais → não renderiza o painel.
    await authedPage.goto('/cash/categories')
    await expect(authedPage.getByRole('heading', { name: /categorias de despesa/i })).toHaveCount(0)
  })
})
