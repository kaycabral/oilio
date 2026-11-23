import type { Page } from '@playwright/test'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { rowAction } from '../helpers/list'
import { choosePaymentMethod } from '../helpers/select'
import {
  pgListByOrg,
  seedAppointment,
  seedClosedOrder,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

const salesRow = (page: Page, label: string | RegExp) =>
  page.getByRole('row').filter({ hasText: label })

type ReadMovement = {
  kind: string
  direction: string
  amountCents: number
  orderId: string | null
}

const CashMovementRow = Schema.Struct({
  kind: Schema.String,
  direction: Schema.String,
  amount_cents: Schema.Union(Schema.NumberFromString, Schema.Number),
  order_id: Schema.NullOr(Schema.String),
})
const decodeCashMovementRow = Schema.decodeUnknownSync(CashMovementRow)

async function readCashMovements(orgId: string): Promise<ReadMovement[]> {
  const rows = await pgListByOrg('cash_movements', orgId)
  return rows.map((row) => {
    const decoded = decodeCashMovementRow(row)
    return {
      kind: decoded.kind,
      direction: decoded.direction,
      amountCents: decoded.amount_cents,
      orderId: decoded.order_id,
    }
  })
}

async function seedSubscriptionCoveredOrder(org: SeededOrg): Promise<void> {
  await seedClosedOrder({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    customerId: null,
    attributedUserId: org.uid,
    totalCents: 0,
    subtotalCents: 5000,
    paymentMethod: null,
    coverage: 'subscription',
  })
}

async function seedOrderFixture(org: SeededOrg): Promise<void> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Financeiro',
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
  await authedPage.getByRole('button', { name: /Cliente Financeiro/ }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
}

async function closeWithCash(authedPage: Page): Promise<void> {
  await choosePaymentMethod(authedPage, 'cash')
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe('Financeiro venda + relatório — DoD (#1059 · 0031)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test.describe('Cenário 1 — venda em dinheiro continua registrada', () => {
    test('fechar com dinheiro grava `sale` (com orderId), undo grava `sale_reversal`; sem gaveta; aparece no relatório de vendas', async ({
      org,
      authedPage,
    }) => {
      await seedOrderFixture(org)

      await startOrder(authedPage)
      await closeWithCash(authedPage)

      const afterClose = await readCashMovements(org.orgId)
      const sales = afterClose.filter((m) => m.kind === 'sale')
      expect(sales).toHaveLength(1)
      expect(sales[0]!.direction).toBe('in')
      expect(sales[0]!.amountCents).toBe(5000)
      expect(sales[0]!.orderId).not.toBeNull()
      expect(afterClose.some((m) => m.kind === 'sangria' || m.kind === 'suprimento')).toBe(false)

      await authedPage.goto('/reports?period=month')
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
      await expect(
        salesRow(authedPage, 'Venda').filter({ hasText: /\+\s*R\$\s*50,00/ }),
      ).toBeVisible()

      await authedPage.goto('/orders?status=closed')
      await rowAction(authedPage, /Cliente Financeiro/, 'Ver detalhes')
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await authedPage.getByRole('button', { name: /Desfazer fechamento/ }).click()
      await expect(authedPage.getByText(/Aberta em/)).toBeVisible({ timeout: 5000 })

      const afterUndo = await readCashMovements(org.orgId)
      expect(afterUndo.filter((m) => m.kind === 'sale')).toHaveLength(1)
      const reversals = afterUndo.filter((m) => m.kind === 'sale_reversal')
      expect(reversals).toHaveLength(1)
      expect(reversals[0]!.direction).toBe('out')
      expect(reversals[0]!.amountCents).toBe(5000)

      await authedPage.goto('/reports?period=month')
      await expect(
        salesRow(authedPage, 'Venda').filter({ hasText: /\+\s*R\$\s*50,00/ }),
      ).toBeVisible()
      await expect(
        salesRow(authedPage, 'Estorno de venda').filter({ hasText: /−\s*R\$\s*50,00/ }),
      ).toBeVisible()
    })
  })

  test.describe('Cenário 2 — financeiro sem gaveta', () => {
    test('sem sangria/suprimento, sem "Caixa" na nav, sem /cash/categories; /cash → /reports', async ({
      authedPage,
    }) => {
      await authedPage.goto('/cash')
      await expect(authedPage).toHaveURL(/\/reports$/)
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()

      await expect(authedPage.getByRole('button', { name: 'Registrar movimento' })).toHaveCount(0)
      await expect(authedPage.getByRole('combobox', { name: 'Tipo' })).toHaveCount(0)
      await expect(authedPage.getByRole('button', { name: /sangria/i })).toHaveCount(0)
      await expect(authedPage.getByRole('button', { name: /suprimento/i })).toHaveCount(0)

      await authedPage.goto('/cash/categories')
      await expect(authedPage.getByRole('heading', { name: /categorias de despesa/i })).toHaveCount(
        0,
      )

      await authedPage.goto('/agenda')
      await expect(sidebar(authedPage).getByRole('link', { name: 'Caixa' })).toHaveCount(0)
    })
  })

  test.describe('Cenário 3 — relatórios num hub', () => {
    test('/reports mostra Vendas + Comissões; rotas antigas colapsam; nav tem "Relatórios", não "Caixa"/"Comissões"', async ({
      authedPage,
    }) => {
      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      await authedPage.goto('/cash/report')
      await expect(authedPage).toHaveURL(/\/reports$/)
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()

      await authedPage.goto('/reports/commissions')
      await expect(authedPage).toHaveURL(/\/reports$/)
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      await authedPage.goto('/agenda')
      const nav = sidebar(authedPage)
      await expect(nav.getByRole('link', { name: 'Relatórios' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Caixa' })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Comissões' })).toHaveCount(0)
    })
  })

  test.describe('Baseline — empty state e dado degenerado', () => {
    test('hub sem dados → empty claro; período sem venda vazio; venda coberta por assinatura não compõe receita', async ({
      org,
      authedPage,
    }) => {
      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByText('Nenhuma venda no período.').first()).toBeVisible()
      await expect(authedPage.getByText('Nenhuma comissão no período.')).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Registrar movimento' })).toHaveCount(0)

      await seedSubscriptionCoveredOrder(org)
      const covered = await readCashMovements(org.orgId)
      expect(covered.filter((m) => m.kind === 'sale')).toHaveLength(0)

      await authedPage.goto('/reports?period=month')
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
      const totalRow = authedPage
        .locator('div')
        .filter({ hasText: /^Total de vendas/ })
        .last()
      await expect(totalRow.getByText('R$ 0,00')).toBeVisible()
      await expect(authedPage.getByText('Nenhuma venda no período.').first()).toBeVisible()
    })
  })
})
