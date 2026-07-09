import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { choosePaymentMethod } from '../helpers/select'
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
): Promise<{ customerId: string; serviceId: string }> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Dialog',
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
  return { customerId, serviceId }
}

test.describe('Order — dialog de confirmação pré-fechamento', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  async function openSeededOrder(authedPage: Page) {
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Dialog/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByRole('heading', { name: 'Cliente Dialog' })).toBeVisible()
  }

  async function openOrder(authedPage: Page, org: SeededOrg) {
    await seedOrderFixture(org)
    await openSeededOrder(authedPage)
  }

  test('AC-01: "Fechar venda" abre dialog com resumo antes do submit', async ({
    org,
    authedPage,
  }) => {
    await openOrder(authedPage, org)

    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()

    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Corte')).toBeVisible()
    await expect(dialog.getByText('Profissional 1')).toBeVisible()
    await expect(dialog.getByText('1 × R$ 50,00')).toBeVisible()
    await expect(dialog.getByText('PIX')).toBeVisible()
    await expect(dialog.getByText('Total')).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Confirmar fechamento/ })).toBeVisible()
  })

  test('AC-02: cancelar o dialog não fecha a order (sem side effect)', async ({
    org,
    authedPage,
  }) => {
    await openOrder(authedPage, org)

    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialog).toBeHidden()

    await expect(authedPage.getByRole('button', { name: /Fechar venda/ })).toBeVisible()
    await expect(authedPage.getByText(/Comissões geradas/i)).toBeHidden()

    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    await expect(dialog).toBeVisible()
    await authedPage.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(authedPage.getByRole('button', { name: /Fechar venda/ })).toBeVisible()
  })

  test('AC-03: erro do backend aparece inline no dialog, sem navegar', async ({
    org,
    authedPage,
  }) => {
    const { customerId, serviceId } = await seedOrderFixture(org)
    const subscriptionId = await seedSubscription(org.orgId, customerId, {
      status: 'active',
      includedItemIds: [serviceId],
    })
    await openSeededOrder(authedPage)

    await expect(
      authedPage.getByRole('combobox', { name: 'Cobertura do item' }).first(),
    ).toHaveText('Consumo do plano')

    await setSubscriptionStatus(org.orgId, subscriptionId, 'cancelled')

    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    await expect(dialog.getByRole('alert')).toContainText(/assinatura/i)
    await expect(dialog).toBeVisible()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
  })
})
