import { liquidationStatusOf } from '@/domain'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { choosePaymentMethod } from '../helpers/select'
import {
  pgListByOrg,
  seedAppointment,
  seedCatalogItem,
  seedCustomer,
  seedMember,
  seedProduct,
  seedService,
  uniqueWhatsapp,
} from '../helpers/session'
import { AgendaPage } from '../pages'

const OrderItemRow = Schema.Struct({ attributedUserId: Schema.String })
const OrderRow = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  customer_id: Schema.NullOr(Schema.String),
  appointment_id: Schema.NullOr(Schema.String),
  items: Schema.Array(OrderItemRow),
})
const decodeOrderRow = Schema.decodeUnknownSync(OrderRow)

const CommissionRow = Schema.Struct({
  attributed_user_id: Schema.NullOr(Schema.String),
  item_name: Schema.NullOr(Schema.String),
  liquidation_status: Schema.optional(Schema.String),
})
const decodeCommissionRow = Schema.decodeUnknownSync(CommissionRow)

type ReadOrder = {
  id: string
  status: string
  customerId: string | null
  appointmentId: string | null
  itemAttributions: (string | null)[]
}

async function readOrders(orgId: string): Promise<ReadOrder[]> {
  const rows = await pgListByOrg('orders', orgId)
  return rows.map((raw) => {
    const row = decodeOrderRow(raw)
    return {
      id: row.id,
      status: row.status,
      customerId: row.customer_id,
      appointmentId: row.appointment_id,
      itemAttributions: row.items.map((it) => it.attributedUserId),
    }
  })
}

type ReadCommission = {
  attributedUserId: string | null
  liquidationStatus: string
  itemName: string | null
}

async function readCommissions(orgId: string): Promise<ReadCommission[]> {
  const rows = await pgListByOrg('commissions', orgId)
  return rows.map((raw) => {
    const row = decodeCommissionRow(raw)
    return {
      attributedUserId: row.attributed_user_id,
      liquidationStatus: liquidationStatusOf({ liquidationStatus: row.liquidation_status }),
      itemName: row.item_name,
    }
  })
}

async function closeWithCash(
  authedPage: Parameters<typeof addCatalogItemToOrder>[0],
): Promise<void> {
  await choosePaymentMethod(authedPage, 'cash')
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe('Venda multi-vertical — DoD (#1054 · 0030)', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test.describe('Cenário 1 — venda avulsa de produto (varejo)', () => {
    test('/orders render+empty → cria avulsa, atribui ao operador, fecha com pagamento → fechada + comissão pendente; sem cliente/agendamento', async ({
      org,
      authedPage,
    }) => {
      await seedCatalogItem(org.orgId, {
        kind: 'product',
        name: 'Cimento CP-II',
        priceCents: 3000,
        commission: { kind: 'percentage', value: 50 },
        unitIds: [org.unitIds[0]!],
      })

      await authedPage.goto('/orders')
      await expect(authedPage.getByText('Nenhuma venda registrada')).toBeVisible()
      const novaVenda = authedPage.getByRole('button', { name: 'Nova venda' })
      await expect(novaVenda).toBeVisible()

      await novaVenda.click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await expect(authedPage.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible()
      await expect(authedPage.getByText('agendamento vinculado')).toBeHidden()

      await addCatalogItemToOrder(authedPage, 'Cimento CP-II')
      const row = authedPage.getByRole('listitem').filter({ hasText: 'Cimento CP-II' })
      await expect(row).toBeVisible()
      await expect(row.getByRole('combobox', { name: 'Vendedor' })).toHaveText('E2E Owner')

      await closeWithCash(authedPage)

      await authedPage.goto('/orders?status=closed')
      await expect(authedPage.getByText('Venda avulsa').first()).toBeVisible()
      await expect(authedPage.getByText('Fechada', { exact: true }).first()).toBeVisible()

      const order = (await readOrders(org.orgId)).find((o) => o.status === 'closed')
      expect(order).toBeDefined()
      expect(order!.customerId).toBeNull()
      expect(order!.appointmentId).toBeNull()
      expect(order!.itemAttributions).toEqual([org.uid])

      const commissions = await readCommissions(org.orgId)
      expect(commissions).toHaveLength(1)
      expect(commissions[0]!.attributedUserId).toBe(org.uid)
      expect(commissions[0]!.liquidationStatus).toBe('pendente')
    })
  })

  test.describe('Cenário 2 — comanda de serviço segue intacta', () => {
    test('agenda → iniciar atendimento → venda ligada ao appointment, serviço atribuído ao pro, fecha + cascata de comissão', async ({
      org,
      authedPage,
    }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte Jornada',
        durationMinutes: 30,
        priceCents: 5000,
        commission: { kind: 'percentage', value: 40 },
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
        commissionSnapshot: { kind: 'percentage', value: 40 },
      })

      const agenda = new AgendaPage(authedPage)
      await agenda.goto('2026-09-08')
      await authedPage.getByRole('button', { name: /Cliente Agendado/ }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()

      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await expect(authedPage.getByRole('heading', { name: 'Cliente Agendado' })).toBeVisible()
      await expect(authedPage.getByText('agendamento vinculado')).toBeVisible()

      const serviceRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Jornada' })
      await expect(serviceRow.getByRole('combobox', { name: 'Executor' })).toBeVisible()

      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`
      await closeWithCash(authedPage)

      const order = (await readOrders(org.orgId)).find((o) => o.status === 'closed')
      expect(order).toBeDefined()
      expect(order!.customerId).toBe(customerId)
      expect(order!.appointmentId).not.toBeNull()
      expect(order!.itemAttributions).toEqual([proUid])

      const commissions = await readCommissions(org.orgId)
      expect(commissions).toHaveLength(1)
      expect(commissions[0]!.attributedUserId).toBe(proUid)
      expect(commissions[0]!.liquidationStatus).toBe('pendente')
    })
  })

  test.describe('Cenário 3 — atribuição obrigatória com default', () => {
    test('serviço-agendamento → pro; produto → operador (editável p/ outro membro); todo item tem dono', async ({
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
      const gerente = await seedMember(org.orgId, { role: 'manager', displayName: 'Gerente Loja' })
      const customerId = await seedCustomer(org.orgId, {
        name: 'Cliente Default',
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
      await authedPage.getByRole('button', { name: /Cliente Default/ }).click()
      await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)

      const serviceRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte' })
      await expect(serviceRow.getByRole('combobox', { name: 'Executor' })).toBeVisible()

      await addCatalogItemToOrder(authedPage, 'Pomada')
      const productSeller = () =>
        authedPage
          .getByRole('listitem')
          .filter({ hasText: 'Pomada' })
          .getByRole('combobox', { name: 'Vendedor' })
      await expect(productSeller()).toHaveText('E2E Owner')

      await productSeller().click()
      await authedPage.getByRole('option', { name: 'Gerente Loja' }).click()
      await expect(productSeller()).toHaveText('Gerente Loja')

      const proUid = `e2e-prof-user-${org.memberOperationIds[0]!}`
      const order = (await readOrders(org.orgId)).find((o) => o.appointmentId != null)
      expect(order).toBeDefined()
      expect(order!.itemAttributions).not.toContain(null)
      expect(order!.itemAttributions).toContain(proUid)
      expect(order!.itemAttributions).toContain(gerente.userId)
    })
  })

  test.describe('Cenário 4 — comissão pro vendedor não-profissional', () => {
    test('produto comissionável da recepção fecha → comissão por membro pendente em /reports/commissions; produto sem regra não comissiona; cancelar re-renderiza', async ({
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
      await seedProduct(org.orgId, { name: 'Prego Sem Comissao', priceCents: 1000 })
      const recepcao = await seedMember(org.orgId, {
        role: 'receptionist',
        displayName: 'Recepção Balcão',
      })

      await authedPage.goto('/orders')
      await authedPage.getByRole('button', { name: 'Nova venda' }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      authedPage.on('dialog', (d) => d.accept())
      await authedPage.getByRole('button', { name: 'Cancelar venda' }).click()
      await expect(authedPage).toHaveURL(/\/orders(\?.*)?$/)
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()

      await authedPage.getByRole('button', { name: 'Nova venda' }).click()
      await expect(authedPage).toHaveURL(/\/orders\/.+/)

      await addCatalogItemToOrder(authedPage, 'Argamassa')
      const argamassaSeller = () =>
        authedPage
          .getByRole('listitem')
          .filter({ hasText: 'Argamassa' })
          .getByRole('combobox', { name: 'Vendedor' })
      await argamassaSeller().click()
      await authedPage.getByRole('option', { name: 'Recepção Balcão' }).click()
      await expect(argamassaSeller()).toHaveText('Recepção Balcão')

      await addCatalogItemToOrder(authedPage, 'Prego Sem Comissao')
      const pregoSeller = () =>
        authedPage
          .getByRole('listitem')
          .filter({ hasText: 'Prego Sem Comissao' })
          .getByRole('combobox', { name: 'Vendedor' })
      await pregoSeller().click()
      await authedPage.getByRole('option', { name: 'Recepção Balcão' }).click()
      await expect(pregoSeller()).toHaveText('Recepção Balcão')

      await closeWithCash(authedPage)

      await authedPage.goto('/reports/commissions')
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()
      await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()
      const memberRow = authedPage.getByRole('row').filter({ hasText: 'Recepção Balcão' })
      await expect(memberRow).toBeVisible()
      await expect(memberRow.getByText('R$ 15,00').first()).toBeVisible()
      await expect(authedPage.getByText('Prego Sem Comissao')).toBeHidden()

      const closed = (await readOrders(org.orgId)).find((o) => o.status === 'closed')
      expect(closed).toBeDefined()
      expect(closed!.itemAttributions).toEqual([recepcao.userId, recepcao.userId])

      const commissions = await readCommissions(org.orgId)
      expect(commissions).toHaveLength(1)
      expect(commissions[0]!.attributedUserId).toBe(recepcao.userId)
      expect(commissions[0]!.itemName).toBe('Argamassa')
      expect(commissions[0]!.liquidationStatus).toBe('pendente')
    })
  })
})
