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
    name: 'Cliente Comissao',
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
  await authedPage.getByRole('button', { name: /Cliente Comissao/ }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
}

async function closeOrder(authedPage: Page): Promise<void> {
  await choosePaymentMethod(authedPage, 'pix')
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe('Comissão 0022 — Definition of Done', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('Cenário 1: comanda fechada gera comissão pendente; produto sem comissão não', async ({
    org,
    authedPage,
  }) => {
    await seedFixture(org)
    await startOrder(authedPage)
    await addCatalogItemToOrder(authedPage, 'Pomada Sem Comissao')
    await closeOrder(authedPage)

    const section = authedPage
      .locator('section')
      .filter({ has: authedPage.getByRole('heading', { name: 'Comissões geradas' }) })
    await expect(section.getByText('· Corte Comissionado')).toBeVisible()
    await expect(section.getByText('R$ 25,00').first()).toBeVisible()
    await expect(section.getByText('Pomada Sem Comissao')).toBeHidden()

    await authedPage.goto('/reports/commissions')
    const row = authedPage.getByRole('listitem').filter({ hasText: 'Corte Comissionado' })
    await expect(row.getByText('Pendente')).toBeVisible()
  })

  test('Cenário 2: owner marca comissão como paga e fica imutável', async ({ org, authedPage }) => {
    await seedFixture(org)
    await startOrder(authedPage)
    await closeOrder(authedPage)

    const proId = org.memberOperationIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    await authedPage.goto(`/reports/commissions?member=${proUser}`)
    const row = authedPage.getByRole('listitem').filter({ hasText: 'Corte Comissionado' })
    await expect(row.getByText('Pendente')).toBeVisible()

    await authedPage.getByLabel('Comprovante').fill('pix://comprovante-feature-dod')
    await authedPage.getByRole('button', { name: 'Marcar pago' }).click()

    await expect(row.getByText('Pago')).toBeVisible({ timeout: 5000 })
    await expect(row.getByText('Pendente')).toBeHidden()
    await expect(authedPage.getByRole('button', { name: 'Marcar pago' })).toBeHidden()
  })

  test('Cenário 3: visão por profissional e período com totais e comanda-origem', async ({
    org,
    authedPage,
  }) => {
    await seedFixture(org)
    await startOrder(authedPage)
    await closeOrder(authedPage)

    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
    const row = authedPage.getByRole('listitem').filter({ hasText: 'Corte Comissionado' })
    await expect(row.getByText('Pendente')).toBeVisible()

    await authedPage.goto('/reports/commissions?period=custom&from=2020-01-01&to=2020-01-31')
    await expect(authedPage.getByText('Nenhuma comissão no período.')).toBeVisible()
  })
})
