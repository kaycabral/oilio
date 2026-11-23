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

test.describe('Comissão por membro (brief 0030, #1057)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('AC-07: produto da recepção fecha → comissão agrupada por membro no relatório', async ({
    org,
    authedPage,
  }) => {
    await seedCatalogItem(org.orgId, {
      kind: 'product',
      name: 'Argamassa Comissionada',
      priceCents: 3000,
      commission: { kind: 'percentage', value: 50 },
      unitIds: [org.unitIds[0]!],
    })
    await seedProduct(org.orgId, { name: 'Prego Sem Comissao', priceCents: 1000 })
    await seedMember(org.orgId, { role: 'receptionist', displayName: 'Recepção Caixa' })

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    await addCatalogItemToOrder(authedPage, 'Argamassa Comissionada')
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: 'Argamassa Comissionada' }),
      'Vendedor',
      'Recepção Caixa',
    )
    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: 'Argamassa Comissionada' })
        .getByRole('combobox', { name: 'Vendedor' }),
    ).toHaveText('Recepção Caixa')

    await addCatalogItemToOrder(authedPage, 'Prego Sem Comissao')
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: 'Prego Sem Comissao' }),
      'Vendedor',
      'Recepção Caixa',
    )

    await choosePaymentMethod(authedPage, 'cash')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    const generated = authedPage.getByRole('heading', { name: 'Comissões geradas' })
    await expect(generated).toBeVisible()

    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()

    const memberRow = authedPage.getByRole('row').filter({ hasText: 'Recepção Caixa' })
    await expect(memberRow).toBeVisible()
    await expect(memberRow.getByText('R$ 15,00').first()).toBeVisible()

    const commItem = authedPage
      .getByRole('listitem')
      .filter({ hasText: 'Argamassa Comissionada' })
      .filter({ hasText: 'Recepção Caixa' })
    await expect(commItem).toBeVisible()
    await expect(authedPage.getByText('Prego Sem Comissao')).toBeHidden()
  })

  test('AC-07: comissão de serviço segue sob o profissional (mesma identidade userId)', async ({
    org,
    authedPage,
  }) => {
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Comissionado',
      durationMinutes: 30,
      priceCents: 5000,
      commission: { kind: 'percentage', value: 40 },
    })
    const customerId = await seedCustomer(org.orgId, {
      name: 'Cliente Servico',
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
      commissionSnapshot: { kind: 'percentage', value: 40 },
    })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Servico/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    await choosePaymentMethod(authedPage, 'cash')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()
    const proRow = authedPage.getByRole('row').filter({ hasText: 'Profissional 1' })
    await expect(proRow).toBeVisible()
    await expect(proRow.getByText('R$ 20,00').first()).toBeVisible()
  })
})
