import { CatalogItemConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { choosePaymentMethod } from '../helpers/select'
import {
  pgReadProjection,
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  uniqueWhatsapp,
} from '../helpers/session'
import { AgendaPage } from '../pages'

async function readStock(orgId: string, itemId: string): Promise<number> {
  const row = await pgReadProjection(
    'catalog_items',
    aggregateRef(CatalogItemConfig, orgId, itemId),
  )
  if (!row) throw new Error(`readStock: catalog item ${itemId} not found`)
  return Number(row.stock ?? 0)
}

test.describe('Venda avulsa — cliente opcional (brief 0030, #1055)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('AC-01: /orders renderiza vazia com CTA "Nova venda"', async ({ authedPage }) => {
    await authedPage.goto('/orders')
    await expect(authedPage.getByText('Nenhuma venda registrada')).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Nova venda' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeHidden()
  })

  test('AC-01/AC-02: cria venda avulsa sem cliente → adiciona produto → fecha → lista fechadas', async ({
    org,
    authedPage,
  }) => {
    const productId = await seedProduct(org.orgId, {
      name: 'Cimento CP-II',
      priceCents: 3000,
      stock: 7,
      unitIds: [org.unitIds[0]!],
    })
    expect(await readStock(org.orgId, productId)).toBe(7)

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()

    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible()
    await expect(authedPage.getByText('agendamento vinculado')).toBeHidden()

    await addCatalogItemToOrder(authedPage, 'Cimento CP-II')
    await expect(authedPage.getByText('Cimento CP-II', { exact: true })).toBeVisible()
    await expect(authedPage.getByText('R$ 30,00').first()).toBeVisible()

    await choosePaymentMethod(authedPage, 'cash')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    expect(await readStock(org.orgId, productId)).toBe(6)

    await authedPage.goto('/orders?status=closed')
    await expect(authedPage.getByText('Venda avulsa').first()).toBeVisible()
    await expect(authedPage.getByText('Fechada', { exact: true }).first()).toBeVisible()
  })

  test('Regressão: venda de agendamento mantém o cliente', async ({ org, authedPage }) => {
    const serviceId = await seedService(org.orgId, {
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 5000,
      commission: { kind: 'percentage', value: 50 },
    })
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
    await expect(authedPage.getByRole('heading', { name: 'Cliente Agendado' })).toBeVisible()
    await expect(authedPage.getByText('agendamento vinculado')).toBeVisible()
  })
})
