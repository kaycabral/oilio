// Feature-level E2E — brief 0002 § Definition of Done (parent #944).
//
// 1 test por scenario do DoD, validando o contrato da feature "redução de erros
// em comanda" como gate do parent (escopo do parent, não da sub-issue):
// - Cenário 1: fechamento com confirmação preventiva (happy path) [critical]
// - Cenário 2: erro de backend tratado inline no dialog [critical]
//
// Roda contra emulator + build de produção (modo canônico do playwright.config;
// E2E_DEV=1 estoura o timeout no 1º compile de /orders/[id]).

import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { chooseOption, choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  seedSubscription,
  type SeededTenant,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// Cancela a assinatura direto no emulator (PATCH só do campo status) — usado pra
// forçar um erro de backend no fechamento de forma determinística.
function cancelSubscription(tenantId: string, subId: string): void {
  const url = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/tenants/${tenantId}/subscriptions/${subId}?updateMask.fieldPaths=status`
  execFileSync('curl', [
    '-fsS',
    '-X',
    'PATCH',
    url,
    '-H',
    'Authorization: Bearer owner',
    '-H',
    'Content-Type: application/json',
    '-d',
    JSON.stringify({ fields: { status: { stringValue: 'cancelled' } } }),
  ])
}

function seedOrderFixture(
  tenant: SeededTenant,
  opts: { withSubscription?: boolean } = {},
): { customerId: string; subId: string | null } {
  const serviceId = seedService(tenant.tenantId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  const customerId = seedCustomer(tenant.tenantId, {
    name: 'Cliente DoD',
    whatsapp: '11922221111',
  })
  const subId = opts.withSubscription
    ? seedSubscription(tenant.tenantId, customerId, {
        planName: 'Mensal Corte',
        usageLimit: { kind: 'count', quantity: 4 },
      })
    : null
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

async function openOrder(
  authedPage: Page,
  tenant: SeededTenant,
  opts: { withSubscription?: boolean } = {},
): Promise<{ subId: string | null }> {
  const { subId } = seedOrderFixture(tenant, opts)
  const agenda = new AgendaPage(authedPage)
  await agenda.goto('2026-09-08')
  await authedPage.getByRole('button', { name: /Cliente DoD/ }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
  await expect(authedPage.getByRole('heading', { name: 'Cliente DoD' })).toBeVisible()
  return { subId }
}

test.describe('Feature 0002 — Definition of Done', () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('Cenário 1: fechamento com confirmação preventiva (happy path)', async ({
    tenant,
    authedPage,
  }) => {
    await openOrder(authedPage, tenant)

    // Cancelar/ESC no dialog não dispara nenhum side effect.
    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Corte')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialog).toBeHidden()
    await expect(authedPage.getByText(/Aberta em/)).toBeVisible()
    await expect(authedPage.getByText('Comissões geradas')).toBeHidden()

    // Confirmar fecha a order e gera a comissão (Corte 50% de R$ 50 = R$ 25).
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('Comissões geradas')).toBeVisible()
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
  })

  test('Cenário 2: erro de backend tratado inline no dialog', async ({ tenant, authedPage }) => {
    // Cliente com assinatura ativa: marca o serviço como consumo do plano, mas a
    // assinatura é cancelada antes do fechamento → closeOrder rejeita o consumo
    // (erro de backend determinístico), e o dialog mostra o erro inline.
    const { subId } = await openOrder(authedPage, tenant, { withSubscription: true })

    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: 'Corte' }),
      'Cobertura do item',
      'Consumo do plano',
    )
    await expect(authedPage.getByText('Consumo do plano').first()).toBeVisible()

    cancelSubscription(tenant.tenantId, subId!)

    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    await expect(dialog.getByRole('alert')).toContainText(/assinatura/i)
    await expect(dialog).toBeVisible()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    // Estado preservado: operador volta o item pra venda e fecha com pix.
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: 'Corte' }),
      'Cobertura do item',
      'Venda',
    )
    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
  })
})
