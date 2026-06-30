// E2E spec — sub-issue #946 do brief 0002 (Undo pós-fechamento, compensação ES).
//
// AC [smoke]/[critical] via browser real (emulator):
// - AC-06: desfazer reabre a order (status open), comissões estornadas (somem)
// - AC-08: estorno do caixa — sale_reversal aparece no relatório de vendas
//
// AC-07 (restore de subscription), AC-09 (janela 5 min) e AC-11 (idempotência)
// têm cobertura unit/reducer em packages/oilio/shared.
//
// Brief 0031 (#1062): o extrato de vendas foi dobrado na seção Vendas do hub
// `/reports` (`/cash` redireciona pra lá); a venda e o estorno coexistem na
// tabela de movimentos.

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

async function seedOrderFixture(org: SeededOrg): Promise<void> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Undo',
    whatsapp: uniqueWhatsapp(),
  })
  await seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    memberOperationId: org.memberOperationIds[0]!,
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
  await authedPage.getByRole('button', { name: /Cliente Undo/ }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
  await expect(authedPage.getByRole('heading', { name: 'Cliente Undo' })).toBeVisible()
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

test.describe('Order — undo pós-fechamento', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('AC-06: desfazer reabre a order e estorna as comissões', async ({ org, authedPage }) => {
    await seedOrderFixture(org)
    await startOrder(authedPage)

    await closeOrderWith(authedPage, 'pix')

    // Fechada: comissão gerada (Corte 50% de R$ 50 = R$ 25) + botão de undo.
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('Comissões geradas')).toBeVisible()
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
    const undo = authedPage.getByRole('button', { name: /Desfazer fechamento/ })
    await expect(undo).toBeVisible()

    await undo.click()

    // Reaberta: volta a editável (painel "Fechar venda") e comissões somem.
    await expect(authedPage.getByText(/Aberta em/)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByRole('button', { name: /Fechar venda/ })).toBeVisible()
    await expect(authedPage.getByText('Comissões geradas')).toBeHidden()
  })

  test('AC-08: desfazer grava estorno no caixa (sale_reversal)', async ({ org, authedPage }) => {
    await seedOrderFixture(org)

    // Caixa sem sessão (brief 0015): o fechamento com dinheiro grava a venda
    // SEMPRE, sem precisar abrir caixa.
    await startOrder(authedPage)
    await closeOrderWith(authedPage, 'cash')
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    await authedPage.getByRole('button', { name: /Desfazer fechamento/ }).click()
    await expect(authedPage.getByText(/Aberta em/)).toBeVisible({ timeout: 5000 })

    // Seção Vendas do hub: a venda e o estorno coexistem (nunca deletamos a
    // venda). `period=month` cobre a data futura seedada. "Venda" é substring de
    // "Estorno de venda", então distinguimos pelo sinal do valor (+ entrada vs.
    // − estorno) pra não violar o strict mode.
    await authedPage.goto('/reports?period=month')
    await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
    await expect(
      authedPage
        .getByRole('row')
        .filter({ hasText: /Venda/ })
        .filter({ hasText: /\+\s*R\$\s*50,00/ }),
    ).toBeVisible()
    await expect(
      authedPage
        .getByRole('row')
        .filter({ hasText: 'Estorno de venda' })
        .filter({ hasText: /−\s*R\$\s*50,00/ }),
    ).toBeVisible()
  })
})
