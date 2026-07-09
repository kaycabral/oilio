import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

async function seedFixture(org: SeededOrg): Promise<void> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte Comissionado',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  await seedProduct(org.orgId, { name: 'Pomada Sem Comissao', priceCents: 3000 })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Accrual',
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
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('AC-02: serviço comissionável gera pendente, produto sem comissão não', async ({
    org,
    authedPage,
  }) => {
    await seedFixture(org)
    await startOrder(authedPage)

    await addCatalogItemToOrder(authedPage, 'Pomada Sem Comissao')

    await closeOrderWith(authedPage, 'pix')
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    const section = authedPage
      .locator('section')
      .filter({ has: authedPage.getByRole('heading', { name: 'Comissões geradas' }) })
    await expect(section).toBeVisible()
    await expect(section.getByText('· Corte Comissionado')).toBeVisible()
    await expect(section.getByText('R$ 25,00').first()).toBeVisible()
    await expect(section.getByText('Pomada Sem Comissao')).toBeHidden()

    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByText('· Corte Comissionado')).toBeVisible()
    const commissionRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Comissionado' })
    await expect(commissionRow.getByText('Pendente')).toBeVisible()
    await expect(authedPage.getByText('Pomada Sem Comissao')).toBeHidden()
  })

  test('AC-04: reabrir a comanda estorna a comissão pendente', async ({ org, authedPage }) => {
    await seedFixture(org)
    await startOrder(authedPage)
    await closeOrderWith(authedPage, 'pix')
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('Comissões geradas')).toBeVisible()

    await authedPage.getByRole('button', { name: /Desfazer fechamento/ }).click()
    await expect(authedPage.getByText(/Aberta em/)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('Comissões geradas')).toBeHidden()

    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByText('· Corte Comissionado')).toBeHidden()
  })
})
