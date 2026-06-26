// Feature-level E2E — brief 0015 § Definition of Done (parent #993).
// 1 test por cenário do DoD, validando o contrato da feature "caixa sem
// abrir/fechar" como gate do parent (escopo do parent, não da sub-issue).
//
// Roda contra emulator + build de produção (modo canônico do playwright.config).

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { choosePaymentMethod } from '../helpers/select'
import { seedAppointment, seedCustomer, seedService, type SeededOrg } from '../helpers/session'
import { AgendaPage } from '../pages'

async function seedOrderFixture(org: SeededOrg): Promise<void> {
  const serviceId = await seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  const customerId = await seedCustomer(org.orgId, {
    name: 'Cliente Caixa',
    whatsapp: '11900001111',
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

async function startAndCloseWithCash(authedPage: Page): Promise<void> {
  const agenda = new AgendaPage(authedPage)
  await agenda.goto('2026-09-08')
  await authedPage.getByRole('button', { name: /Cliente Caixa/ }).click()
  await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
  await expect(authedPage).toHaveURL(/\/orders\/.+/)
  await choosePaymentMethod(authedPage, 'cash')
  await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
  const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
  await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
  await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })
}

test.describe('Caixa 0015 — Definition of Done', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('Cenário 1: venda em dinheiro grava movimento sem sessão', async ({ org, authedPage }) => {
    await seedOrderFixture(org)
    // Fecha a comanda com dinheiro SEM abrir caixa nenhum.
    await startAndCloseWithCash(authedPage)

    // O movimento `sale` aparece na seção Vendas do hub `/reports` (brief 0031
    // #1062 dobrou o relatório de caixa no hub). A linha da tabela tem Tipo
    // "Venda" + valor +R$ 50,00; `period=month` cobre a data futura seedada.
    await authedPage.goto('/reports?period=month')
    await expect(authedPage.getByRole('heading', { name: 'Vendas' })).toBeVisible()
    const saleRow = authedPage
      .getByRole('row')
      .filter({ hasText: 'Venda' })
      .filter({ hasText: /\+\s*R\$\s*50,00/ })
    await expect(saleRow).toBeVisible()
  })

  // Cenário 2/3 do DoD do 0015 (gaveta manual + relatório de gaveta) foram
  // removidos pelo brief 0031: financeiro V0 é venda + relatório, sem gaveta.
  // A cobertura de remoção da superfície manual vive em
  // tests/e2e/cash/sale-only-residue.spec.ts.
})
