import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption } from '../helpers/select'
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
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  await seedProduct(org.orgId, { name: 'Pomada', priceCents: 3000 })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Ciclo',
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

test.describe('Order — ciclo de vida event-first (#1018)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 2,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('add item → troca executor → desconto → remove item → cancela', async ({
    org,
    authedPage,
  }) => {
    await seedFixture(org)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Ciclo/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    const orderUrl = authedPage.url()
    await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()

    await addCatalogItemToOrder(authedPage, 'Pomada')
    const pomadaRow = authedPage.getByRole('listitem').filter({ hasText: 'Pomada' })
    await expect(pomadaRow).toBeVisible()
    await expect(authedPage.getByText('R$ 80,00').first()).toBeVisible()

    await chooseOption(pomadaRow, 'Vendedor', 'Profissional 2')
    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: 'Pomada' })
        .getByRole('combobox', { name: 'Vendedor' }),
    ).toHaveText(/Profissional 2/)

    await authedPage.locator('input[name="discount"]').fill('10')
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage.getByText('R$ 70,00').first()).toBeVisible()

    await authedPage.locator('input[name="discount"]').fill('9999')
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(
      authedPage.getByText(/desconto não pode ser maior que o subtotal/i).first(),
    ).toBeVisible()
    await expect(authedPage.getByText('R$ 70,00').first()).toBeVisible()

    await authedPage.locator('input[name="discount"]').fill('10')
    await authedPage.getByRole('button', { name: 'Salvar' }).click()

    await authedPage
      .getByRole('listitem')
      .filter({ hasText: 'Pomada' })
      .getByRole('button', { name: 'Remover item' })
      .click()
    await expect(authedPage.getByText('Pomada', { exact: true })).toHaveCount(0)
    await expect(authedPage.getByText('R$ 40,00').first()).toBeVisible()

    authedPage.on('dialog', (d) => d.accept())
    await authedPage.getByRole('button', { name: 'Cancelar venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders(\?.*)?$/)
    await authedPage.goto(orderUrl)
    await expect(authedPage.getByText(/Cancelada em/)).toBeVisible()
  })
})
