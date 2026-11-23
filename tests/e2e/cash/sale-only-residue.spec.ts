import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { rowAction } from '../helpers/list'
import { choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

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
    mobile: uniqueWhatsapp(),
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
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('guardrail: fechamento grava `sale`, undo grava `sale_reversal`', async ({
    org,
    authedPage,
  }) => {
    await seedOrderFixture(org)

    await startOrder(authedPage)
    await closeWithCash(authedPage)
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    await authedPage.goto('/reports?period=month')
    await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
    const saleRow = salesRow(authedPage, 'Venda').filter({ hasText: /\+\s*R\$\s*50,00/ })
    await expect(saleRow).toBeVisible()

    await authedPage.goto('/orders?status=closed')
    await rowAction(authedPage, /Cliente Residuo/, 'Ver detalhes')
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await authedPage.getByRole('button', { name: /Desfazer fechamento/ }).click()
    await expect(authedPage.getByText(/Aberta em/)).toBeVisible({ timeout: 5000 })

    await authedPage.goto('/reports?period=month')
    await expect(
      salesRow(authedPage, 'Venda').filter({ hasText: /\+\s*R\$\s*50,00/ }),
    ).toBeVisible()
    await expect(
      salesRow(authedPage, 'Estorno de venda').filter({ hasText: /−\s*R\$\s*50,00/ }),
    ).toBeVisible()
  })

  test('gaveta manual e categorias removidas da UI', async ({ authedPage }) => {
    await authedPage.goto('/cash')
    await expect(authedPage).toHaveURL(/\/reports$/)
    await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()

    await expect(authedPage.getByRole('button', { name: 'Registrar movimento' })).toHaveCount(0)
    await expect(authedPage.getByRole('combobox', { name: 'Tipo' })).toHaveCount(0)

    await authedPage.goto('/cash/categories')
    await expect(authedPage.getByRole('heading', { name: /categorias de despesa/i })).toHaveCount(0)
  })
})
