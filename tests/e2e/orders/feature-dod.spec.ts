import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { chooseOption, choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  seedSubscription,
  setSubscriptionStatus,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

async function seedOrderFixture(
  org: SeededOrg,
  opts: { withSubscription?: boolean } = {},
): Promise<{ customerId: string; subId: string | null }> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente DoD',
    mobile: uniqueWhatsapp(),
  })
  const subId = opts.withSubscription
    ? await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
      })
    : null
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
  return { customerId, subId }
}

async function openOrder(
  authedPage: Page,
  org: SeededOrg,
  opts: { withSubscription?: boolean } = {},
): Promise<{ subId: string | null }> {
  const { subId } = await seedOrderFixture(org, opts)
  const agenda = new AgendaPage(authedPage)
  await agenda.goto('2026-09-08')
  await authedPage.getByRole('button', { name: /Cliente DoD/ }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
  await expect(authedPage.getByRole('heading', { name: 'Cliente DoD' })).toBeVisible()
  return { subId }
}

test.describe('Feature 0002 — Definition of Done', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('Cenário 1: fechamento com confirmação preventiva (happy path)', async ({
    org,
    authedPage,
  }) => {
    await openOrder(authedPage, org)

    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Corte')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialog).toBeHidden()
    await expect(authedPage.getByText(/Aberta em/)).toBeVisible()
    await expect(authedPage.getByText('Comissões geradas')).toBeHidden()

    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('Comissões geradas')).toBeVisible()
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
  })

  test('Cenário 2: erro de backend tratado inline no dialog', async ({ org, authedPage }) => {
    const { subId } = await openOrder(authedPage, org, { withSubscription: true })

    await expect(authedPage.getByText('Consumo do plano').first()).toBeVisible()

    await setSubscriptionStatus(org.orgId, subId!, 'cancelled')

    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    await expect(dialog.getByRole('alert')).toContainText(/assinatura/i)
    await expect(dialog).toBeVisible()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: 'Corte' }),
      'Cobertura do item',
      'Venda',
    )
    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
  })
})
