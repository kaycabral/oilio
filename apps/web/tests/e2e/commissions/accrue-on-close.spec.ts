// E2E spec — brief 0022 Grupo B (#999), AC-02 + AC-04 (accrual no fechamento).
//
// - AC-02 [smoke]: fechar comanda com serviço comissionável gera Commission
//   pendente (por executor, valor = snapshot da regra); produto sem comissão
//   (`commission: null`) não gera registro.
// - AC-04 [edge]: reabrir a comanda estorna a comissão pendente (some).
//
// Fecha pelo fluxo real (agenda → iniciar → adicionar item → fechar) e confere
// na projeção `/reports/commissions`, que é o que a slice 3 (#1000) lê.

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  type SeededTenant,
} from '../helpers/session'
import { AgendaPage } from '../pages'

function seedFixture(tenant: SeededTenant): void {
  const serviceId = seedService(tenant.tenantId, {
    name: 'Corte Comissionado',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  // Produto sem comissão — não deve gerar Commission (dado degenerado).
  seedProduct(tenant.tenantId, { name: 'Pomada Sem Comissao', priceCents: 3000 })
  const customerId = seedCustomer(tenant.tenantId, {
    name: 'Cliente Accrual',
    whatsapp: '11955551111',
  })
  seedAppointment({
    tenantId: tenant.tenantId,
    unitId: tenant.unitIds[0]!,
    professionalId: tenant.professionalIds[0]!,
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
  await authedPage.getByRole('button', { name: /Cliente Accrual/ }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
}

async function closeOrderWith(
  authedPage: Page,
  method: 'cash' | 'credit_card' | 'debit_card' | 'pix',
): Promise<void> {
  await choosePaymentMethod(authedPage, method)
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
}

test.describe('Comissão — accrual no fechamento (#999)', { tag: '@critical' }, () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('AC-02: serviço comissionável gera pendente, produto sem comissão não', async ({
    tenant,
    authedPage,
  }) => {
    seedFixture(tenant)
    await startOrder(authedPage)

    // Adiciona o produto sem comissão (venda) ao lado do serviço comissionável.
    await addCatalogItemToOrder(authedPage, 'Pomada Sem Comissao')

    await closeOrderWith(authedPage, 'pix')
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    // OrderDetail: comissão do serviço (50% de R$50 = R$25). Escopa na seção
    // "Comissões geradas" — só uma linha (a do serviço); o produto sem comissão
    // não gera registro.
    const section = authedPage
      .locator('section')
      .filter({ has: authedPage.getByRole('heading', { name: 'Comissões geradas' }) })
    await expect(section).toBeVisible()
    await expect(section.getByText('· Corte Comissionado')).toBeVisible()
    await expect(section.getByText('R$ 25,00').first()).toBeVisible()
    await expect(section.getByText('Pomada Sem Comissao')).toBeHidden()

    // Projeção lida pela slice 3: a comissão pendente aparece no relatório.
    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByText('· Corte Comissionado')).toBeVisible()
    // Status `Pendente` na linha da comissão (escopo na listitem para não
    // colidir com a opção `Pendente` do filtro de status).
    const commissionRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Comissionado' })
    await expect(commissionRow.getByText('Pendente')).toBeVisible()
    await expect(authedPage.getByText('Pomada Sem Comissao')).toBeHidden()
  })

  test('AC-04: reabrir a comanda estorna a comissão pendente', async ({ tenant, authedPage }) => {
    seedFixture(tenant)
    await startOrder(authedPage)
    await closeOrderWith(authedPage, 'pix')
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('Comissões geradas')).toBeVisible()

    await authedPage.getByRole('button', { name: /Desfazer fechamento/ }).click()
    await expect(authedPage.getByText(/Aberta em/)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('Comissões geradas')).toBeHidden()

    // A comissão sumiu da projeção lida pela slice 3.
    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByText('· Corte Comissionado')).toBeHidden()
  })
})
