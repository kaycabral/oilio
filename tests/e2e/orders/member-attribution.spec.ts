import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption, choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCatalogItem,
  seedCustomer,
  seedMember,
  seedProduct,
  seedService,
  uniqueWhatsapp,
} from '../helpers/session'
import { AgendaPage } from '../pages'

test.describe('Atribuição de item por membro (brief 0030, #1056)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('AC-04: produto avulso default-atribui ao operador (membro que abriu)', async ({
    org,
    authedPage,
  }) => {
    await seedProduct(org.orgId, { name: 'Cimento CP-II', priceCents: 3000 })

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    await addCatalogItemToOrder(authedPage, 'Cimento CP-II')
    const row = authedPage.getByRole('listitem').filter({ hasText: 'Cimento CP-II' })
    await expect(row).toBeVisible()

    const sellerSelect = row.getByRole('combobox', { name: 'Vendedor' })
    await expect(sellerSelect).toHaveText('E2E Owner')
  })

  test('AC-04: edita a atribuição do item pra outro membro', async ({ org, authedPage }) => {
    await seedProduct(org.orgId, { name: 'Tinta Branca', priceCents: 5000 })
    await seedMember(org.orgId, { role: 'manager', displayName: 'Gerente Loja' })

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await addCatalogItemToOrder(authedPage, 'Tinta Branca')

    const row = authedPage.getByRole('listitem').filter({ hasText: 'Tinta Branca' })
    await chooseOption(row, 'Vendedor', 'Gerente Loja')

    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: 'Tinta Branca' })
        .getByRole('combobox', { name: 'Vendedor' }),
    ).toHaveText('Gerente Loja')
  })

  test('AC-05: venda de produto pela recepção (sem MemberOperation) atribui e fecha', async ({
    org,
    authedPage,
  }) => {
    await seedCatalogItem(org.orgId, {
      kind: 'product',
      name: 'Argamassa',
      priceCents: 3000,
      commission: { kind: 'percentage', value: 50 },
      unitIds: [org.unitIds[0]!],
    })
    await seedMember(org.orgId, { role: 'receptionist', displayName: 'Recepção Balcão' })

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    await addCatalogItemToOrder(authedPage, 'Argamassa')
    const row = authedPage.getByRole('listitem').filter({ hasText: 'Argamassa' })
    await chooseOption(row, 'Vendedor', 'Recepção Balcão')
    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: 'Argamassa' })
        .getByRole('combobox', { name: 'Vendedor' }),
    ).toHaveText('Recepção Balcão')

    await choosePaymentMethod(authedPage, 'cash')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    await expect(authedPage.getByRole('heading', { name: 'Comissões geradas' })).toBeVisible()
    const commissionRow = authedPage
      .getByRole('listitem')
      .filter({ hasText: 'Recepção Balcão' })
      .filter({ hasText: 'Pendente' })
    await expect(commissionRow).toBeVisible()
    await expect(commissionRow.getByText('R$ 15,00')).toBeVisible()
  })

  test('AC-04: produto numa venda de agendamento default-atribui ao operador', async ({
    org,
    authedPage,
  }) => {
    const serviceId = await seedService(org.orgId, {
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 5000,
      commission: { kind: 'percentage', value: 50 },
    })
    await seedProduct(org.orgId, { name: 'Pomada', priceCents: 2000 })
    const customerId = await seedCustomer(org.orgId, {
      name: 'Cliente Agendado',
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

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Agendado/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    const serviceRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte' })
    await expect(serviceRow.getByRole('combobox', { name: 'Executor' })).toBeVisible()

    await addCatalogItemToOrder(authedPage, 'Pomada')
    const productRow = authedPage.getByRole('listitem').filter({ hasText: 'Pomada' })
    await expect(productRow.getByRole('combobox', { name: 'Vendedor' })).toHaveText('E2E Owner')
  })
})
