// Brief 0030 (#1057) — comissão chaveada por membro (`attributedUserId`).
//
// AC-06: regra resolvida do item/unidade aplicada ao membro atribuído, qualquer
// papel; sem regra → sem comissão (mas a atribuição registra quem vendeu).
// AC-07: o registro de comissão é chaveado pelo `userId` do membro e
// `/reports/commissions` agrupa POR MEMBRO ("Por membro").
//
// Cobertura ponta-a-ponta (fecha a venda de verdade pela UI, não seed direto):
//   1. Produto comissionável vendido pela RECEPÇÃO numa venda avulsa → ao fechar
//      gera comissão PENDENTE chaveada pelo userId da recepção, que aparece em
//      /reports/commissions agrupada sob o nome dela.
//   2. Produto SEM regra de comissão na mesma venda → atribuído (quem vendeu fica
//      registrado) mas NÃO gera registro de comissão (degenerado, guardrail).
//   3. Serviço comissionável segue exibindo a linha do profissional no relatório
//      (mesma identidade `userId` — agrupar por membro não esconde o pro).

import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { chooseOption, choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCatalogItem,
  seedCustomer,
  seedMember,
  seedProduct,
  seedService,
} from '../helpers/session'
import { AgendaPage } from '../pages'

test.describe('Comissão por membro (brief 0030, #1057)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('AC-07: produto da recepção fecha → comissão agrupada por membro no relatório', async ({
    org,
    authedPage,
  }) => {
    // Produto comissionável (50% de R$ 30 = R$ 15) atribuível a qualquer membro.
    await seedCatalogItem(org.orgId, {
      kind: 'product',
      name: 'Argamassa Comissionada',
      priceCents: 3000,
      commission: { kind: 'percentage', value: 50 },
      unitIds: [org.unitIds[0]!],
    })
    // Produto SEM regra (degenerado): atribuído mas não comissiona (AC-06).
    await seedProduct(org.orgId, { name: 'Prego Sem Comissao', priceCents: 1000 })
    // Recepção sem MemberOperation — é quem a re-chave por membro precisa creditar.
    await seedMember(org.orgId, { role: 'receptionist', displayName: 'Recepção Caixa' })

    await authedPage.goto('/orders')
    await authedPage.getByRole('button', { name: 'Nova venda' }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    // Produto comissionável → recepção.
    await addCatalogItemToOrder(authedPage, 'Argamassa Comissionada')
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: 'Argamassa Comissionada' }),
      'Vendedor',
      'Recepção Caixa',
    )
    await expect(
      authedPage
        .getByRole('listitem')
        .filter({ hasText: 'Argamassa Comissionada' })
        .getByRole('combobox', { name: 'Vendedor' }),
    ).toHaveText('Recepção Caixa')

    // Produto sem regra → recepção também (atribuído, mas não comissiona).
    await addCatalogItemToOrder(authedPage, 'Prego Sem Comissao')
    await chooseOption(
      authedPage.getByRole('listitem').filter({ hasText: 'Prego Sem Comissao' }),
      'Vendedor',
      'Recepção Caixa',
    )

    // Fecha com dinheiro (sem cliente, sem profissional aprovado — venda avulsa).
    await choosePaymentMethod(authedPage, 'cash')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    // Degenerado (AC-06): só UMA comissão gerada — a do produto comissionável.
    // O produto sem regra fica atribuído mas não vira registro de comissão.
    const generated = authedPage.getByRole('heading', { name: 'Comissões geradas' })
    await expect(generated).toBeVisible()

    // Relatório agrupa POR MEMBRO: a recepção aparece com a comissão pendente.
    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()

    // Linha por-membro da recepção: R$ 15,00 (50% de R$ 30) pendente. O valor
    // aparece nas colunas Pendente e Total (única comissão pendente) — basta
    // confirmar presença na linha.
    const memberRow = authedPage.getByRole('row').filter({ hasText: 'Recepção Caixa' })
    await expect(memberRow).toBeVisible()
    await expect(memberRow.getByText('R$ 15,00').first()).toBeVisible()

    // A lista detalhada mostra a comissão sob o nome da recepção; o produto sem
    // regra (Prego) NÃO aparece como comissão.
    const commItem = authedPage
      .getByRole('listitem')
      .filter({ hasText: 'Argamassa Comissionada' })
      .filter({ hasText: 'Recepção Caixa' })
    await expect(commItem).toBeVisible()
    await expect(authedPage.getByText('Prego Sem Comissao')).toBeHidden()
  })

  test('AC-07: comissão de serviço segue sob o profissional (mesma identidade userId)', async ({
    org,
    authedPage,
  }) => {
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Comissionado',
      durationMinutes: 30,
      priceCents: 5000,
      commission: { kind: 'percentage', value: 40 },
    })
    const customerId = await seedCustomer(org.orgId, {
      name: 'Cliente Servico',
      whatsapp: '11955551111',
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
    await authedPage.getByRole('button', { name: /Cliente Servico/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    await choosePaymentMethod(authedPage, 'cash')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    // No relatório, agrupado por membro, a comissão do serviço (40% de R$ 50 =
    // R$ 20) aparece sob o profissional executor (membro de papel memberOperation;
    // a chave é o userId dele, mesma identidade).
    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()
    const proRow = authedPage.getByRole('row').filter({ hasText: 'Profissional 1' })
    await expect(proRow).toBeVisible()
    await expect(proRow.getByText('R$ 20,00').first()).toBeVisible()
  })
})
