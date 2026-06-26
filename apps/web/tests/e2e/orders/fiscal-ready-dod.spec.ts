// Feature-level E2E — brief 0021 § Definition of Done (parent #989).
//
// 1 test por cenário do DoD, validando o contrato da feature "Fechamento
// fiscal-ready (pagamento real + assinatura como consumo)" como gate do parent
// — escopo cross-component do parent, não das sub-issues isoladas
// (#990/#991/#992):
// - Cenário 1: venda real fecha com forma de pagamento real [critical]
// - Cenário 2: comanda 100% coberta fecha como consumo (sem tender, sem NF) [critical]
// - Cenário 3: comanda mista (coberto + vendido) [critical]
//
// Nome distinto de `orders/feature-dod.spec.ts` (DoD do brief 0002 #944).
// Roda contra emulator + build de produção (modo canônico do playwright.config).

import { SubscriptionConfig } from '@/domain/aggregates'
import { aggregateRef } from '@/domain/effect'
import type { Page } from '@playwright/test'
import { Schema } from 'effect'
import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption, choosePaymentMethod } from '../helpers/select'
import {
  pgReadProjection,
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  seedSubscription,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// The `subscriptions` projection stores the period as a JSONB `current_period`
// column; this spec only reads its `consumed` counter (the plan-usage balance).
const CurrentPeriodSchema = Schema.Struct({
  consumed: Schema.optional(Schema.Number),
})
const decodeCurrentPeriod = Schema.decodeUnknownSync(CurrentPeriodSchema)

// Reads the plan-usage `consumed` counter off the Postgres `subscriptions`
// projection (post-cutover). `current_period` is JSONB → decode the nested
// counter; absent/null period → 0 (mirrors the old emulator read).
async function readConsumed(orgId: string, subId: string): Promise<number> {
  const row = await pgReadProjection(
    'subscriptions',
    aggregateRef(SubscriptionConfig, orgId, subId),
  )
  if (!row) throw new Error(`readConsumed: subscription ${subId} not found`)
  return decodeCurrentPeriod(row.current_period).consumed ?? 0
}

// Seed de um atendimento de serviço (Corte) pra um cliente nomeado. Quando
// `withSubscription`, cria assinatura ativa por contagem (saldo 4) — chave dos
// cenários de consumo.
async function seedServiceFor(
  org: SeededOrg,
  customerName: string,
  whatsapp: string,
  withSubscription: boolean,
): Promise<{ customerId: string; subId: string | null }> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  // Cada cenário roda em org próprio (fixture) com whatsapp distinto — o
  // Customer é org-scoped, sem colisão entre cenários.
  const customerId = await seedCustomer(org.orgId, { name: customerName, whatsapp })
  const subId = withSubscription
    ? await seedSubscription(org.orgId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
      })
    : null
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
  return { customerId, subId }
}

async function startOrderFor(authedPage: Page, customerName: string): Promise<void> {
  const agenda = new AgendaPage(authedPage)
  await agenda.goto('2026-09-08')
  await authedPage.getByRole('button', { name: new RegExp(customerName) }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
}

async function confirmClose(authedPage: Page): Promise<void> {
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe(
  'Feature 0021 — Definition of Done (fechamento fiscal-ready)',
  { tag: '@critical' },
  () => {
    test.use({
      orgInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    test('Cenário 1: venda real fecha com forma de pagamento real', async ({ org, authedPage }) => {
      // Cliente SEM assinatura → o item é venda; o fechamento exige forma real.
      await seedServiceFor(org, 'Cliente Venda', '11944440001', false)
      await startOrderFor(authedPage, 'Cliente Venda')

      // Total a pagar = o serviço vendido (R$ 50,00) — base da receita/NF futura.
      await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()

      // Forma de pagamento real obrigatória (AC-02) → dinheiro.
      await choosePaymentMethod(authedPage, 'cash')
      await confirmClose(authedPage)

      // Fechou com o instrumento real registrado (base pra NF futura).
      await expect(authedPage.getByText(/Dinheiro/).first()).toBeVisible()
    })

    test('Cenário 2: comanda 100% coberta fecha como consumo (sem tender, sem NF)', async ({
      org,
      authedPage,
    }) => {
      const { subId } = await seedServiceFor(org, 'Cliente Plano', '11944440002', true)
      await startOrderFor(authedPage, 'Cliente Plano')

      // Marca o Corte como consumo do plano → comanda fica 100% coberta.
      await chooseOption(
        authedPage.getByRole('listitem').filter({ hasText: 'Corte' }),
        'Cobertura do item',
        'Consumo do plano',
      )

      // Sem item de venda → fecha sem forma de pagamento (AC-06).
      await expect(authedPage.getByText(/100% coberta pelo plano/)).toBeVisible()
      await confirmClose(authedPage)

      // Saldo do plano decrementado; nenhuma receita/forma de pagamento gerada.
      expect(await readConsumed(org.orgId, subId!)).toBe(1)
    })

    test('Cenário 3: comanda mista (coberto + vendido) → paga só o produto', async ({
      org,
      authedPage,
    }) => {
      const { subId } = await seedServiceFor(org, 'Cliente Misto', '11944440003', true)
      await seedProduct(org.orgId, { name: 'Pomada', priceCents: 3000 })
      await startOrderFor(authedPage, 'Cliente Misto')

      // Serviço coberto (consumo) → some do total a pagar.
      await chooseOption(
        authedPage.getByRole('listitem').filter({ hasText: 'Corte' }),
        'Cobertura do item',
        'Consumo do plano',
      )
      await expect(authedPage.getByText('Consumo do plano').first()).toBeVisible()

      // Produto vendido (venda real) pelo "Adicionar item" único (#1005).
      await addCatalogItemToOrder(authedPage, 'Pomada')

      // Total a pagar = só o produto (R$ 30,00); o serviço é consumo.
      await expect(authedPage.getByText('R$ 30,00').first()).toBeVisible()

      await choosePaymentMethod(authedPage, 'pix')
      await confirmClose(authedPage)

      // Produto fechou com PIX; o serviço debitou 1 do plano.
      await expect(authedPage.getByText(/PIX/).first()).toBeVisible()
      expect(await readConsumed(org.orgId, subId!)).toBe(1)
    })
  },
)
