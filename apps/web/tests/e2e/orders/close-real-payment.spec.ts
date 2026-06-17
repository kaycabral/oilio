import type { Page } from '@playwright/test'
import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { parseJson } from '../helpers/firestore-rest'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption, choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  seedSubscription,
  type SeededTenant,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// Brief 0021 — fechamento fiscal-ready (pagamento real + assinatura como consumo).
// Baseline E2E (princípio #17): cria comanda mista (venda + consumo), fecha,
// confere total a pagar + saldo do plano; remove a venda → 100% consumo fecha
// sem pagamento; assinatura sem saldo → não marca consumo (degenerado).

// The subscription doc shape, narrowed to the nested
// `currentPeriod.consumed.integerValue` this spec reads.
const SubscriptionConsumedSchema = Schema.Struct({
  fields: Schema.optional(
    Schema.Struct({
      currentPeriod: Schema.optional(
        Schema.Struct({
          mapValue: Schema.optional(
            Schema.Struct({
              fields: Schema.optional(
                Schema.Struct({
                  consumed: Schema.optional(
                    Schema.Struct({ integerValue: Schema.optional(Schema.String) }),
                  ),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
})
const decodeSubscriptionConsumed = Schema.decodeUnknownSync(SubscriptionConsumedSchema)

function readConsumed(tenantId: string, subId: string): number {
  const url = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/tenants/${tenantId}/subscriptions/${subId}`
  const out = execFileSync('curl', ['-fsS', url, '-H', 'Authorization: Bearer owner'], {
    encoding: 'utf8',
  })
  const data = parseJson(out, decodeSubscriptionConsumed)
  return Number(data.fields?.currentPeriod?.mapValue?.fields?.consumed?.integerValue ?? '0')
}

function seedFixture(
  tenant: SeededTenant,
  subOpts: Parameters<typeof seedSubscription>[2] = {},
): { customerId: string; subId: string } {
  const serviceId = seedService(tenant.tenantId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  seedProduct(tenant.tenantId, { name: 'Pomada', priceCents: 3000 })
  const customerId = seedCustomer(tenant.tenantId, {
    name: 'Cliente Plano',
    whatsapp: '11944443333',
  })
  const subId = seedSubscription(tenant.tenantId, customerId, {
    planName: 'Mensal Corte',
    usageLimit: { kind: 'count', quantity: 4 },
    ...subOpts,
  })
  seedAppointment({
    tenantId: tenant.tenantId,
    unitId: tenant.unitIds[0]!,
    professionalId: tenant.professionalIds[0]!,
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

test.describe('Order — fechamento fiscal-ready (#990/#991/#992)', { tag: '@critical' }, () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  async function startOrder(authedPage: Page) {
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Plano/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
  }

  test('comanda mista: serviço coberto + produto vendido → paga só o produto, consome 1', async ({
    tenant,
    authedPage,
  }) => {
    const { subId } = seedFixture(tenant)
    await startOrder(authedPage)

    // Marca o Corte como consumo do plano → some do total a pagar (AC-03/05).
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: 'Corte' }),
      'Cobertura do item',
      'Consumo do plano',
    )
    await expect(authedPage.getByText('Consumo do plano').first()).toBeVisible()

    // Adiciona Pomada (venda) pelo "Adicionar item" único (#1005, AC-11).
    await addCatalogItemToOrder(authedPage, 'Pomada')

    // Total a pagar = só o produto (R$ 30,00); o serviço é consumo.
    await expect(authedPage.getByText('R$ 30,00').first()).toBeVisible()

    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    await expect(authedPage.getByText(/Fechada em/)).toBeVisible()
    await expect(authedPage.getByText(/PIX/).first()).toBeVisible()
    // Plano consumiu 1 serviço (o Corte coberto).
    expect(readConsumed(tenant.tenantId, subId)).toBe(1)
  })

  test('comanda 100% coberta fecha sem forma de pagamento (AC-06)', async ({
    tenant,
    authedPage,
  }) => {
    const { subId } = seedFixture(tenant)
    await startOrder(authedPage)

    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: 'Corte' }),
      'Cobertura do item',
      'Consumo do plano',
    )

    // Sem item de venda → painel mostra que fecha sem pagamento.
    await expect(authedPage.getByText(/100% coberta pelo plano/)).toBeVisible()
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog.getByText('Consumo do plano')).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    await expect(authedPage.getByText(/Fechada em/)).toBeVisible()
    expect(readConsumed(tenant.tenantId, subId)).toBe(1)
  })

  test('assinatura sem saldo: opção de consumo fica desabilitada (degenerado)', async ({
    tenant,
    authedPage,
  }) => {
    // Plano por contagem com saldo esgotado (quantity 1, já consumido 1).
    seedFixture(tenant, { usageLimit: { kind: 'count', quantity: 1 }, consumed: 1 })
    await startOrder(authedPage)

    const coverage = authedPage
      .getByRole('listitem')
      .filter({ hasText: 'Corte' })
      .getByRole('combobox', { name: 'Cobertura do item' })
    await expect(coverage).toBeVisible()
    // A cobertura migrou pra combobox Radix: a opção desabilitada é um
    // <SelectItem disabled> renderizado num portal só quando o combobox abre.
    await coverage.click()
    await expect(authedPage.getByRole('option', { name: 'Consumo do plano' })).toBeDisabled()
  })
})
