// Feature-level E2E — parent #1059 (epic 0031 "Financeiro V0 = venda + relatório").
//
// This is the PARENT's composite journey: it validates the brief's Definition
// of Done end-to-end (Cenários 1–3 + baseline), NOT the granular per-AC
// coverage the sub-issue specs already prove exhaustively against the emulator:
//   - cash/sale-only-residue.spec.ts   (#1060 · Cenário 1/2 — fechamento grava
//     `sale`/`sale_reversal` sem gaveta; sangria/suprimento + /cash/categories
//     removidos)
//   - reports/reports-hub.spec.ts      (#1062 · Cenário 3 — `/reports` é o hub
//     Vendas + Comissões; rotas antigas colapsam; nav perde Caixa/Comissões)
//   - orders/undo-close.spec.ts        (#946  · AC-08 — undo grava `sale_reversal`)
//
// Here we re-assert the SAME invariants stitched into the one journey the
// owner/manager lives, driving the FINAL UX after the 3 subs:
//   - venda em dinheiro continua registrada: fechar com dinheiro grava o
//     movimento `sale` (com `orderId`); desfazer grava `sale_reversal` — SEM
//     passar por qualquer tela de gaveta (que não existe mais);
//   - financeiro sem gaveta: sem operação de sangria/suprimento, sem item
//     "Caixa" na nav, sem `/cash/categories`; o que existe é o relatório de
//     vendas, e `/cash` redireciona pro hub `/reports`;
//   - relatórios num hub: `/reports` mostra Vendas (por período) + Comissões na
//     mesma casca; as rotas antigas `/cash/report` e `/reports/commissions`
//     colapsam/redirecionam pro hub;
//   - baseline: `/reports` render + empty (sem vendas → empty claro, sem ação
//     fantasma); fluxo real (fechar uma venda → aparece no relatório de vendas
//     do período); degenerado (período sem nenhuma venda; venda só com cobertura
//     de assinatura não compõe receita).
//
// Runs against the running emulator (auth only; no mocks). Seeds via the session
// helpers and reads cash-movement state straight from the Postgres projection to
// assert the stitched invariants. The active unit is pinned with
// `setActiveUnitCookie` for multi-unit orgs to skip the interstitial where
// the journey is about the scoped surface (not the picker itself).

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
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

const sidebar = (page: Page) => page.locator('[data-sidebar="content"]')

// Brief 0031 (#1062): `/cash` colapsou no hub `/reports`. As linhas da venda
// aparecem na tabela de movimentos da seção Vendas. "Venda" é substring de
// "Estorno de venda", então distinguimos pelo sinal do valor (+ entrada vs.
// − estorno) pra não violar o strict mode quando ambas as linhas coexistem.
const salesRow = (page: Page, label: string | RegExp) =>
  page.getByRole('row').filter({ hasText: label })

// --- Postgres cash_movements reader (event-store projection) -------------------
// The journey reads the `cash_movements` projection straight from Postgres to
// assert the invariant the UI only hints at: the automatic financial record of a
// sale (`sale` with `orderId`) and its append-only reversal (`sale_reversal`)
// exist WITHOUT any cash-drawer surface. Columns are snake_case; `amount_cents`
// is a bigint (pg returns it as a string) — decode it via Schema.NumberFromString.
type ReadMovement = {
  kind: string
  direction: string
  amountCents: number
  orderId: string | null
}

// Lenient row schema — only the fields this journey asserts. `amount_cents` may
// arrive as a string (bigint) or number depending on the driver; accept either.
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

// Seeds a closed order paid ENTIRELY via subscription coverage — the degenerate
// the brief calls out: it generates NO `sale` cash movement, so it never
// composes the Vendas period revenue. Mirrors production reality (a fully
// covered close emits no `sale` and writes `paymentMethod: null`, since no cash
// changes hands — see `close.actions.ts`); we seed the complete projection via
// the central typed helper instead of driving the fragile subscription-close
// dialog. The single item is `coverage: 'subscription'` (gross R$ 50,00) while
// the order settles to R$ 0,00.
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
    whatsapp: '11955554444',
  })
  await seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    professionalId: org.professionalIds[0]!,
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

// Closes the open sale via the WORKING payment path (cash) — never the broken
// `subscription` option (pre-existing bug, see venda-multi-vertical.spec.ts).
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
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  // Cenário 1 — venda em dinheiro continua registrada. Folds in the "fluxo real"
  // baseline: fechar uma venda → ela aparece no relatório de vendas do período.
  // Fechar com dinheiro grava o movimento `sale` (com `orderId`) SEM passar por
  // qualquer tela de gaveta; desfazer grava `sale_reversal` (append-only, a
  // venda nunca some). Os invariantes são lidos direto do Postgres.
  test.describe('Cenário 1 — venda em dinheiro continua registrada', () => {
    test('fechar com dinheiro grava `sale` (com orderId), undo grava `sale_reversal`; sem gaveta; aparece no relatório de vendas', async ({
      org,
      authedPage,
    }) => {
      await seedOrderFixture(org)

      // Fecha com dinheiro pelo caminho da agenda → grava a venda sem depender de
      // gaveta (nenhuma tela de caixa no fluxo).
      await startOrder(authedPage)
      await closeWithCash(authedPage)

      // Invariante (Postgres): existe UM `sale` de R$ 50,00, entrada, com orderId.
      const afterClose = await readCashMovements(org.orgId)
      const sales = afterClose.filter((m) => m.kind === 'sale')
      expect(sales).toHaveLength(1)
      expect(sales[0]!.direction).toBe('in')
      expect(sales[0]!.amountCents).toBe(5000)
      expect(sales[0]!.orderId).not.toBeNull()
      // Nenhuma operação manual de gaveta foi gravada pra registrar a venda.
      expect(afterClose.some((m) => m.kind === 'sangria' || m.kind === 'suprimento')).toBe(false)

      // Fluxo real (baseline): a venda aparece na seção Vendas do hub (mês cobre a
      // data futura seedada), rotulada "Venda" com valor +R$ 50,00.
      await authedPage.goto('/reports?period=month')
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
      await expect(
        salesRow(authedPage, 'Venda').filter({ hasText: /\+\s*R\$\s*50,00/ }),
      ).toBeVisible()

      // Desfaz o fechamento → `sale_reversal` coexiste com a venda (compensação
      // append-only). A order fechou, então vive sob o filtro "Fechadas".
      await authedPage.goto('/orders?status=closed')
      // Orders rows are List items; open the detail via the ⋯ menu ("Ver detalhes"),
      // which links to /orders/{id} (rows are no longer plain links).
      await rowAction(authedPage, /Cliente Financeiro/, 'Ver detalhes')
      await expect(authedPage).toHaveURL(/\/orders\/.+/)
      await authedPage.getByRole('button', { name: /Desfazer fechamento/ }).click()
      await expect(authedPage.getByText(/Aberta em/)).toBeVisible({ timeout: 5000 })

      // Invariante (Postgres): `sale` permanece + um `sale_reversal` de saída.
      const afterUndo = await readCashMovements(org.orgId)
      expect(afterUndo.filter((m) => m.kind === 'sale')).toHaveLength(1)
      const reversals = afterUndo.filter((m) => m.kind === 'sale_reversal')
      expect(reversals).toHaveLength(1)
      expect(reversals[0]!.direction).toBe('out')
      expect(reversals[0]!.amountCents).toBe(5000)

      // E ambas as linhas coexistem na seção Vendas (distinguidas pelo sinal).
      await authedPage.goto('/reports?period=month')
      await expect(
        salesRow(authedPage, 'Venda').filter({ hasText: /\+\s*R\$\s*50,00/ }),
      ).toBeVisible()
      await expect(
        salesRow(authedPage, 'Estorno de venda').filter({ hasText: /−\s*R\$\s*50,00/ }),
      ).toBeVisible()
    })
  })

  // Cenário 2 — financeiro sem gaveta. Não há sangria/suprimento, nem item
  // "Caixa" na nav, nem `/cash/categories`; o que existe é o relatório de vendas
  // (e `/cash` redireciona pro hub `/reports`).
  test.describe('Cenário 2 — financeiro sem gaveta', () => {
    test('sem sangria/suprimento, sem "Caixa" na nav, sem /cash/categories; /cash → /reports', async ({
      authedPage,
    }) => {
      // `/cash` colapsou no hub: a rota redireciona pro relatório.
      await authedPage.goto('/cash')
      await expect(authedPage).toHaveURL(/\/reports$/)
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()

      // Sem superfície de registro manual: nem form de movimento, nem seletor de
      // tipo (sangria/suprimento/despesa), nem botões de operação de gaveta.
      await expect(authedPage.getByRole('button', { name: 'Registrar movimento' })).toHaveCount(0)
      await expect(authedPage.getByRole('combobox', { name: 'Tipo' })).toHaveCount(0)
      await expect(authedPage.getByRole('button', { name: /sangria/i })).toHaveCount(0)
      await expect(authedPage.getByRole('button', { name: /suprimento/i })).toHaveCount(0)

      // Rota de categorias de despesa não existe mais → não renderiza o painel.
      await authedPage.goto('/cash/categories')
      await expect(authedPage.getByRole('heading', { name: /categorias de despesa/i })).toHaveCount(
        0,
      )

      // Nav: sem item "Caixa".
      await authedPage.goto('/agenda')
      await expect(sidebar(authedPage).getByRole('link', { name: 'Caixa' })).toHaveCount(0)
    })
  })

  // Cenário 3 — relatórios num hub. `/reports` mostra Vendas (por período) +
  // Comissões na mesma casca; as rotas antigas `/cash/report` e
  // `/reports/commissions` colapsam/redirecionam pro hub; a nav ganha
  // "Relatórios" e perde "Caixa"/"Comissões".
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

      // `/cash/report` (era a seção Vendas) → hub.
      await authedPage.goto('/cash/report')
      await expect(authedPage).toHaveURL(/\/reports$/)
      await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()

      // `/reports/commissions` (era a seção Comissões) → hub.
      await authedPage.goto('/reports/commissions')
      await expect(authedPage).toHaveURL(/\/reports$/)
      await expect(
        authedPage.getByRole('heading', { name: 'Relatório de comissões' }),
      ).toBeVisible()

      // Nav: "Relatórios" presente (owner), "Caixa"/"Comissões" ausentes.
      await authedPage.goto('/agenda')
      const nav = sidebar(authedPage)
      await expect(nav.getByRole('link', { name: 'Relatórios' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Caixa' })).toHaveCount(0)
      await expect(nav.getByRole('link', { name: 'Comissões' })).toHaveCount(0)
    })
  })

  // Baseline — render + empty state e dado degenerado. `/reports` abre sem dados
  // com empty state claro (sem ação fantasma); um período sem nenhuma venda
  // continua vazio; e uma venda só com cobertura de assinatura NÃO compõe a
  // receita do período (não gera `sale`, então o "Total de vendas" não cresce).
  test.describe('Baseline — empty state e dado degenerado', () => {
    test('hub sem dados → empty claro; período sem venda vazio; venda coberta por assinatura não compõe receita', async ({
      org,
      authedPage,
    }) => {
      // Render + empty: hub abre sem dados, com empty claro e sem ação fantasma.
      await authedPage.goto('/reports')
      await expect(authedPage.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
      await expect(authedPage.getByText('Nenhuma venda no período.').first()).toBeVisible()
      await expect(authedPage.getByText('Nenhuma comissão no período.')).toBeVisible()
      // Empty não oferece nenhuma ação de gaveta (sem "Registrar movimento").
      await expect(authedPage.getByRole('button', { name: 'Registrar movimento' })).toHaveCount(0)

      // Degenerado: uma venda fechada SÓ com cobertura de assinatura (R$ 0 em
      // dinheiro) → não gera `sale`, logo não compõe a receita do período.
      await seedSubscriptionCoveredOrder(org)
      // Invariante (Postgres): nenhum `sale` foi gravado pela venda coberta.
      const covered = await readCashMovements(org.orgId)
      expect(covered.filter((m) => m.kind === 'sale')).toHaveLength(0)

      // O relatório do mês (cobre a data atual seedada) segue sem receita: o
      // "Total de vendas" é R$ 0,00 e o empty da seção Vendas permanece.
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
