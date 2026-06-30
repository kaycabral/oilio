// E2E spec — sub-issue #945 do brief 0002 (Tela de revisão pré-fechamento).
//
// AC [smoke]/[critical] via browser real (emulator):
// - AC-01: clicar "Fechar venda" abre dialog com resumo (item + executor + total + método)
// - AC-02: cancelar / ESC fecha o dialog sem fechar a order (nenhum side effect)
// - AC-03: erro do backend (closeOrder) aparece inline no dialog, sem navegar

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedService,
  seedSubscription,
  setSubscriptionStatus,
  uniqueWhatsapp,
  type SeededOrg,
} from '../helpers/session'
import { AgendaPage } from '../pages'

async function seedOrderFixture(
  org: SeededOrg,
): Promise<{ customerId: string; serviceId: string }> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Dialog',
    whatsapp: uniqueWhatsapp(),
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
  return { customerId, serviceId }
}

test.describe('Order — dialog de confirmação pré-fechamento', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  async function openSeededOrder(authedPage: Page) {
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Dialog/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByRole('heading', { name: 'Cliente Dialog' })).toBeVisible()
  }

  async function openOrder(authedPage: Page, org: SeededOrg) {
    await seedOrderFixture(org)
    await openSeededOrder(authedPage)
  }

  test('AC-01: "Fechar venda" abre dialog com resumo antes do submit', async ({
    org,
    authedPage,
  }) => {
    await openOrder(authedPage, org)

    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()

    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    // Resumo: item + executor por item + valor da linha + método + total.
    await expect(dialog.getByText('Corte')).toBeVisible()
    await expect(dialog.getByText('Profissional 1')).toBeVisible()
    await expect(dialog.getByText('1 × R$ 50,00')).toBeVisible()
    await expect(dialog.getByText('PIX')).toBeVisible()
    await expect(dialog.getByText('Total')).toBeVisible()
    // Ainda não fechou — a order continua aberta atrás do dialog.
    await expect(dialog.getByRole('button', { name: /Confirmar fechamento/ })).toBeVisible()
  })

  test('AC-02: cancelar o dialog não fecha a order (sem side effect)', async ({
    org,
    authedPage,
  }) => {
    await openOrder(authedPage, org)

    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialog).toBeHidden()

    // Nenhum side effect: order segue editável (botão de fechar visível) e sem comissão.
    await expect(authedPage.getByRole('button', { name: /Fechar venda/ })).toBeVisible()
    await expect(authedPage.getByText(/Comissões geradas/i)).toBeHidden()

    // ESC também fecha sem efeito.
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    await expect(dialog).toBeVisible()
    await authedPage.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(authedPage.getByRole('button', { name: /Fechar venda/ })).toBeVisible()
  })

  test('AC-03: erro do backend aparece inline no dialog, sem navegar', async ({
    org,
    authedPage,
  }) => {
    // Trigger determinístico de rejeição do `closeOrder` alcançável por UI
    // válida: o item é marcado como "Consumo do plano" enquanto o cliente tem
    // assinatura ATIVA (a marcação passa), depois a assinatura é cancelada
    // (race real: cancelada em outra sessão com a comanda aberta). No
    // fechamento, `closeOrder` re-consulta a assinatura ativa, não acha
    // nenhuma e rejeita com "Cliente não possui assinatura ativa para o
    // consumo marcado" — o que prova o contrato de erro inline (dialog segue
    // aberto, com `alert`, sem navegar). O método anterior ("subscription" no
    // select de pagamento) ficou inalcançável: não existe forma de pagamento
    // `subscription`, e a cobertura por item é guardada na UI.
    const { customerId, serviceId } = await seedOrderFixture(org)
    const subscriptionId = await seedSubscription(org.orgId, customerId, {
      status: 'active',
      // Cobre o item da comanda explicitamente — a marcação de cobertura passa.
      includedItemIds: [serviceId],
    })
    await openSeededOrder(authedPage)

    // Com assinatura ativa cobrindo o item, a comanda já nasce com ele em
    // "Consumo do plano" (auto-marcação, brief 0079) — sem flip manual.
    await expect(
      authedPage.getByRole('combobox', { name: 'Cobertura do item' }).first(),
    ).toHaveText('Consumo do plano')

    // Assinatura cancelada com a comanda aberta → o fechamento vai falhar.
    await setSubscriptionStatus(org.orgId, subscriptionId, 'cancelled')

    // Sem item de venda, a venda fecha "100% coberta" — botão habilitado.
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    // Erro inline; dialog permanece aberto; URL não muda (continua na order).
    await expect(dialog.getByRole('alert')).toContainText(/assinatura/i)
    await expect(dialog).toBeVisible()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
  })
})
