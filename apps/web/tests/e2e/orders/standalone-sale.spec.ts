// Brief 0030 (#1055) — venda avulsa + cliente opcional.
//
// Baseline obrigatório da fatia (DoD): /orders renderiza com CTA "Nova venda";
// criar uma venda AVULSA (appointmentId null) SEM cliente → adicionar um produto
// atribuído a um profissional aprovado → fechar com dinheiro → aparece na lista
// de fechadas como "Venda avulsa". Regressão: venda nascida de agendamento
// continua carregando o cliente do appointment.
//
// Atribuição de item é por membro (`attributedUserId` = userId) com default
// esperto (brief 0030, AC-04 / #1056): o produto avulso fica atribuído ao membro
// que abriu a venda (o owner seedado). O caso de varejo puro — recepção sem
// Professional vendendo balcão — é coberto em member-attribution.spec.ts.

import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { choosePaymentMethod } from '../helpers/select'
import { seedAppointment, seedCustomer, seedProduct, seedService } from '../helpers/session'
import { AgendaPage } from '../pages'

test.describe('Venda avulsa — cliente opcional (brief 0030, #1055)', { tag: '@critical' }, () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('AC-01: /orders renderiza vazia com CTA "Nova venda"', async ({ authedPage }) => {
    // No sales in the active unit → protagonist empty-state (brief 0034 / #1073):
    // the EmptyState takes over with the single "Nova venda" CTA; header + tabs
    // are hidden.
    await authedPage.goto('/orders')
    await expect(authedPage.getByText('Nenhuma venda registrada')).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Nova venda' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeHidden()
  })

  test('AC-01/AC-02: cria venda avulsa sem cliente → adiciona produto → fecha → lista fechadas', async ({
    tenant,
    authedPage,
  }) => {
    // Produto comissionável (50% de R$ 30 = R$ 15) atribuível ao profissional.
    seedProduct(tenant.tenantId, { name: 'Cimento CP-II', priceCents: 3000 })

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()

    // Abre uma venda avulsa: sem agendamento, sem cliente.
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByRole('heading', { name: 'Venda avulsa' })).toBeVisible()
    // Não há agendamento vinculado.
    await expect(authedPage.getByText('agendamento vinculado')).toBeHidden()

    // Adiciona o produto atribuído ao profissional aprovado seedado.
    await addCatalogItemToOrder(authedPage, 'Cimento CP-II')
    await expect(authedPage.getByText('Cimento CP-II', { exact: true })).toBeVisible()
    await expect(authedPage.getByText('R$ 30,00').first()).toBeVisible()

    // Fecha com dinheiro (sem cliente não há cobertura de assinatura possível).
    await choosePaymentMethod(authedPage, 'cash')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    // Aparece na lista de fechadas rotulada como "Venda avulsa".
    await authedPage.goto('/orders?status=closed')
    await expect(authedPage.getByText('Venda avulsa').first()).toBeVisible()
    await expect(authedPage.getByText('Fechada', { exact: true }).first()).toBeVisible()
  })

  test('Regressão: venda de agendamento mantém o cliente', async ({ tenant, authedPage }) => {
    const serviceId = seedService(tenant.tenantId, {
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 5000,
      commission: { kind: 'percentage', value: 50 },
    })
    const customerId = seedCustomer(tenant.tenantId, {
      name: 'Cliente Agendado',
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

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Agendado/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()

    // A venda nasce ligada ao appointment e carrega o cliente — NÃO é "Venda avulsa".
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByRole('heading', { name: 'Cliente Agendado' })).toBeVisible()
    await expect(authedPage.getByText('agendamento vinculado')).toBeVisible()
  })
})
