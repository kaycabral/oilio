// Feature-level E2E — brief 0022 § Definition of Done (parent #997).
// 1 test por cenário do DoD, validando o contrato da feature "comissão com
// liquidação manual básica (pendente/pago)" como gate do parent — escopo do
// parent (journey cross-component), não das sub-issues #998/#999/#1000.
//
// Cada cenário exerce o fluxo real (fecha comanda pela agenda → projeção em
// `/reports/commissions`), nunca seed idealizado de Commission — é o ponto do
// Feature-level: amarrar fechamento → relatório → pagamento ponta a ponta.
//
// Roda contra emulator + build de produção (modo canônico do playwright.config).

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { addCatalogItemToOrder } from '../helpers/orders'
import { choosePaymentMethod } from '../helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  type SeededTenant,
} from '../helpers/session'
import { AgendaPage } from '../pages'

// Serviço comissionável (50% de R$50 = R$25) + produto sem comissão (dado
// degenerado: `commission: null` não gera Commission) + appointment agendado.
function seedFixture(tenant: SeededTenant): void {
  const serviceId = seedService(tenant.tenantId, {
    name: 'Corte Comissionado',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  seedProduct(tenant.tenantId, { name: 'Pomada Sem Comissao', priceCents: 3000 })
  const customerId = seedCustomer(tenant.tenantId, {
    name: 'Cliente Comissao',
    whatsapp: '11955552222',
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

async function startOrder(authedPage: Page): Promise<void> {
  const agenda = new AgendaPage(authedPage)
  await agenda.goto('2026-09-08')
  await authedPage.getByRole('button', { name: /Cliente Comissao/ }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
}

async function closeOrder(authedPage: Page): Promise<void> {
  await choosePaymentMethod(authedPage, 'pix')
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe('Comissão 0022 — Definition of Done', () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('Cenário 1: comanda fechada gera comissão pendente; produto sem comissão não', async ({
    tenant,
    authedPage,
  }) => {
    seedFixture(tenant)
    await startOrder(authedPage)
    // Produto sem comissão na mesma comanda (venda) — dado degenerado.
    await addCatalogItemToOrder(authedPage, 'Pomada Sem Comissao')
    await closeOrder(authedPage)

    // Comissão do serviço nasce pendente (50% de R$50 = R$25); o produto sem
    // comissão não gera registro.
    const section = authedPage
      .locator('section')
      .filter({ has: authedPage.getByRole('heading', { name: 'Comissões geradas' }) })
    await expect(section.getByText('· Corte Comissionado')).toBeVisible()
    await expect(section.getByText('R$ 25,00').first()).toBeVisible()
    await expect(section.getByText('Pomada Sem Comissao')).toBeHidden()

    // E aparece pendente na projeção lida pelo relatório.
    await authedPage.goto('/reports/commissions')
    const row = authedPage.getByRole('listitem').filter({ hasText: 'Corte Comissionado' })
    await expect(row.getByText('Pendente')).toBeVisible()
  })

  test('Cenário 2: owner marca comissão como paga e fica imutável', async ({
    tenant,
    authedPage,
  }) => {
    seedFixture(tenant)
    await startOrder(authedPage)
    await closeOrder(authedPage)

    // Lote por membro (gesto que move dinheiro) — só aparece filtrado. A chave
    // da comissão é o `userId` do membro atribuído (brief 0030/0039), então o
    // filtro usa `?member=<userId>` — não o id do doc Professional.
    const proId = tenant.professionalIds[0]!
    const proUser = `e2e-prof-user-${proId}`
    await authedPage.goto(`/reports/commissions?member=${proUser}`)
    const row = authedPage.getByRole('listitem').filter({ hasText: 'Corte Comissionado' })
    await expect(row.getByText('Pendente')).toBeVisible()

    // Marca pago com comprovante opcional.
    await authedPage.getByLabel('Comprovante').fill('pix://comprovante-feature-dod')
    await authedPage.getByRole('button', { name: 'Marcar pago' }).click()

    // Vira pago e o lote some (sem pendente no recorte) — imutabilidade do batch.
    await expect(row.getByText('Pago')).toBeVisible({ timeout: 5000 })
    await expect(row.getByText('Pendente')).toBeHidden()
    await expect(authedPage.getByRole('button', { name: 'Marcar pago' })).toBeHidden()
  })

  test('Cenário 3: visão por profissional e período com totais e comanda-origem', async ({
    tenant,
    authedPage,
  }) => {
    seedFixture(tenant)
    await startOrder(authedPage)
    await closeOrder(authedPage)

    await authedPage.goto('/reports/commissions')
    await expect(authedPage.getByRole('heading', { name: 'Relatório de comissões' })).toBeVisible()
    // Total pendente por membro (único membro → R$ 25,00). O agrupamento foi
    // re-chaveado por membro (`attributedUserId`) no brief 0030/0039.
    await expect(authedPage.getByRole('heading', { name: 'Por membro' })).toBeVisible()
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
    // Comanda-origem visível na linha da comissão.
    const row = authedPage.getByRole('listitem').filter({ hasText: 'Corte Comissionado' })
    await expect(row.getByText('Pendente')).toBeVisible()

    // Empty state: outro período (sem comissões) abre sem erro.
    await authedPage.goto('/reports/commissions?period=custom&from=2020-01-01&to=2020-01-31')
    await expect(authedPage.getByText('Nenhuma comissão no período.')).toBeVisible()
  })
})
