import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  type SeededTenant,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// #1018 (brief 0025) — a comanda + itens event-first: cada mutação (criar,
// adicionar/remover item, trocar atribuição, desconto/observação, cancelar) emite
// evento e a projeção reflete. Baseline E2E exercitando o ciclo de vida real
// (sem o fechamento — fatia #1026) com asserção de outcome a cada passo.
// Brief 0030 (AC-04): a atribuição de item é por membro (`attributedUserId`).

function seedFixture(tenant: SeededTenant): void {
  const serviceId = seedService(tenant.tenantId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  seedProduct(tenant.tenantId, { name: 'Pomada', priceCents: 3000 })
  const customerId = seedCustomer(tenant.tenantId, {
    name: 'Cliente Ciclo',
    whatsapp: '11955554444',
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
}

test.describe('Order — ciclo de vida event-first (#1018)', { tag: '@critical' }, () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 2,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('add item → troca executor → desconto → remove item → cancela', async ({
    tenant,
    authedPage,
  }) => {
    seedFixture(tenant)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Ciclo/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    const orderUrl = authedPage.url()
    await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()

    // order.item_added — adiciona Pomada → total R$ 80 (Adicionar item único).
    await addCatalogItemToOrder(authedPage, 'Pomada')
    const pomadaRow = authedPage.getByRole('listitem').filter({ hasText: 'Pomada' })
    await expect(pomadaRow).toBeVisible()
    await expect(authedPage.getByText('R$ 80,00').first()).toBeVisible()

    // order.item_attribution_changed (brief 0030, AC-04) — re-atribui a Pomada
    // (produto → rótulo "Vendedor") ao Profissional 2 por membro. A atribuição
    // grava o `userId` do membro, não o doc id de Professional. O select é
    // controlado pela projeção (props) — após o router.refresh do server action,
    // reflete o novo membro (prova de que o evento projetou).
    await chooseOption(pomadaRow, 'Vendedor', 'Profissional 2')
    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: 'Pomada' })
        .getByRole('combobox', { name: 'Vendedor' }),
    ).toHaveText(/Profissional 2/)

    // order.meta_updated — desconto de R$ 10 → total R$ 70.
    await authedPage.locator('input[name="discount"]').fill('10')
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage.getByText('R$ 70,00').first()).toBeVisible()

    // order.item_removed — remove a Pomada → subtotal 5000 − desconto 1000 = R$ 40.
    await authedPage
      .getByRole('listitem')
      .filter({ hasText: 'Pomada' })
      .getByRole('button', { name: 'Remover item' })
      .click()
    await expect(authedPage.getByText('Pomada', { exact: true })).toHaveCount(0)
    await expect(authedPage.getByText('R$ 40,00').first()).toBeVisible()

    // order.cancelled — cancela a comanda (confirm nativo). No sucesso navega
    // pra /orders; voltar ao detalhe prova a projeção (status Cancelada).
    authedPage.on('dialog', (d) => d.accept())
    await authedPage.getByRole('button', { name: 'Cancelar venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders(\?.*)?$/)
    await authedPage.goto(orderUrl)
    await expect(authedPage.getByText(/Cancelada em/)).toBeVisible()
  })
})
