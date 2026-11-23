import type { CashMovement } from '@/domain'
import { CashMovementConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import {
  CASH_MOVEMENT_COLUMNS,
  cashMovementColumnValues,
} from '@/shared/db/pg/effect/cash-movement-projector'
import type { Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { expect, test } from '../fixtures'
import { seedClosedOrder, setMembershipRole } from '../helpers/session'

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

function uniqueSuffix(): string {
  return `${Date.now()}-${randomBytes(4).toString('hex')}`
}

async function seedSaleMovement(orgId: string, unitId: string, amountCents: number): Promise<void> {
  const id = `e2e-mov-${uniqueSuffix()}`
  const now = new Date().toISOString()
  const orderId = await seedClosedOrder({
    orgId,
    unitId,
    customerId: null,
    attributedUserId: 'system',
    totalCents: amountCents,
  })
  const doc: CashMovement = {
    id,
    orgId,
    unitId,
    kind: 'sale',
    direction: 'in',
    amountCents,
    paymentMethod: 'cash',
    orderId,
    expenseCategoryId: null,
    description: null,
    recordedByUid: 'system',
    createdAt: now,
  }
  const ref = aggregateRef(CashMovementConfig, orgId, id)
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO events (aggregate_type, aggregate_id, version, org_id, envelope)
       VALUES ($1, $2, 1, $3, $4)`,
      [
        ref.type,
        ref.id,
        ref.orgId,
        {
          _tag: 'cash_movement.created',
          version: 1,
          timestamp: now,
          actorId: 'e2e-seed',
          schemaVersion: 1,
          payload: { data: doc },
        },
      ],
    )
    const values = cashMovementColumnValues(doc, ref, 1)
    const placeholders = CASH_MOVEMENT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')
    await client.query(
      `INSERT INTO cash_movements (${CASH_MOVEMENT_COLUMNS.join(', ')}) VALUES (${placeholders})`,
      [...values],
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

test.describe('Hub /reports (#1062 · 0031 AC-05/06)', () => {
  test.describe('single-unit owner', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('hub renderiza seções Vendas + Comissões', async ({ org, authedPage }) => {
      await seedSaleMovement(org.orgId, org.unitIds[0]!, 5000)

      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()
      await expect(
        authedPage
          .getByRole('row')
          .filter({ hasText: 'Venda' })
          .filter({ hasText: /R\$\s*50,00/ }),
      ).toBeVisible()
    })

    test('baseline: hub sem dados abre com empty state claro', async ({ authedPage }) => {
      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByText('Nenhuma venda no período.').first()).toBeVisible()
      await expect(authedPage.getByText('Nenhuma comissão no período.')).toBeVisible()
      await expect(authedPage.getByText('Nenhum atendimento coberto no período.')).toBeVisible()
    })

    test('rota antiga de comissões redireciona pro hub', async ({ authedPage }) => {
      await authedPage.goto('/reports/commissions')
      await expect(authedPage).toHaveURL(/\/reports$/)
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()
    })

    test('rotas /cash colapsam → redirecionam pro hub /reports', async ({ authedPage }) => {
      for (const route of ['/cash', '/cash/report']) {
        await authedPage.goto(route)
        await expect(authedPage).toHaveURL(/\/reports$/)
      }
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
    })

    test('nav: "Relatórios" presente; "Caixa"/"Comissões" ausentes', async ({ authedPage }) => {
      await authedPage.goto('/agenda')
      const nav = sidebar(authedPage)
      await expect(nav.getByRole('link', { name: 'Relatórios' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Caixa' })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Comissões' })).toHaveCount(0)
    })

    test('nav: recepção não vê "Relatórios" (requires manageOrg)', async ({ org, authedPage }) => {
      await setMembershipRole(`${org.orgId}_${org.uid}`, 'receptionist')
      await authedPage.goto('/agenda')
      const nav = sidebar(authedPage)
      await expect(nav.getByRole('link', { name: 'Relatórios' })).toHaveCount(0)
      await authedPage.goto('/reports')
      await expect(authedPage).toHaveURL(/\/agenda$/)
    })
  })

  test.describe('unidade ativa (sem agregado — 0044)', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('owner 2-unidades: sem toggle; ?units=all não agrega (param morto)', async ({
      org,
      authedPage,
    }) => {
      const [unitA, unitB] = org.unitIds
      await seedSaleMovement(org.orgId, unitA!, 5000)
      await seedSaleMovement(org.orgId, unitB!, 9900)

      await authedPage.goto('/reports')
      await expect(authedPage).toHaveURL(/\/select-unit$/)
      await authedPage.getByRole('button', { name: 'Unidade 1' }).click()
      await expect(authedPage).toHaveURL(/\/agenda$/)

      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Todas as unidades' })).toHaveCount(0)
      const aRow = authedPage
        .getByRole('row')
        .filter({ hasText: 'Venda' })
        .filter({ hasText: /R\$\s*50,00/ })
      const bRow = authedPage
        .getByRole('row')
        .filter({ hasText: 'Venda' })
        .filter({ hasText: /R\$\s*99,00/ })
      await expect(aRow).toBeVisible()
      await expect(bRow).toHaveCount(0)

      await authedPage.goto('/reports?units=all')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByRole('checkbox', { name: 'Todas as unidades' })).toHaveCount(0)
      await expect(aRow).toBeVisible()
      await expect(bRow).toHaveCount(0)
    })
  })
})
