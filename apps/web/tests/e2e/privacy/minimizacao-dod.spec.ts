// Feature-level E2E — brief 0040 (minimização de texto livre), DoD do parent
// #1108. 1 test() por cenário do DoD: cada um prova a AUSÊNCIA do campo de texto
// livre removido (notes/tags) E que o fluxo segue funcionando. As provas por
// fatia vivem nos baselines (customers/orders/agenda); aqui o parent re-afirma o
// contrato inteiro num lugar só (princípio #15).

import { expect, test } from '../fixtures'
import { seedCustomer, seedOpenOrder, seedService } from '../helpers/session'
import { AgendaPage } from '../pages'

test.describe('Minimização de texto livre — DoD 0040 (#1108)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  // Cenário 1 — cadastrar cliente sem texto livre.
  test('cenário 1: cadastro de cliente sem campo de notas nem tags', async ({ authedPage }) => {
    await authedPage.goto('/customers/new')
    await expect(authedPage.locator('input[name="name"]')).toBeVisible()
    // Os campos de texto livre removidos NÃO existem mais.
    await expect(authedPage.locator('[name="tags"]')).toHaveCount(0)
    await expect(authedPage.locator('textarea[name="notes"]')).toHaveCount(0)
    await expect(authedPage.getByText('Observações')).toHaveCount(0)
    // Fluxo segue: cadastra só com os campos estruturados.
    const ts = Date.now()
    await authedPage.locator('input[name="name"]').fill(`Cliente DoD ${ts}`)
    await authedPage.locator('input[name="whatsapp"]').fill(`119${String(ts).slice(-8)}`)
    await authedPage.getByRole('button', { name: 'Criar' }).click()
    await expect(authedPage).toHaveURL(/\/customers$/)
    await expect(authedPage.getByText(`Cliente DoD ${ts}`)).toBeVisible({ timeout: 5000 })
  })

  // Cenário 2 — fechar venda sem observações.
  test('cenário 2: detalhe da venda sem campo de observações (só desconto)', async ({
    org,
    authedPage,
  }) => {
    const customerId = seedCustomer(org.orgId, { name: `Cli Venda ${Date.now()}` })
    const orderId = seedOpenOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId,
      attributedUserId: org.uid,
    })
    await authedPage.goto(`/orders/${orderId}`)
    // O form de meta da venda não tem mais "Observações" — só o desconto.
    await expect(authedPage.locator('textarea[name="notes"]')).toHaveCount(0)
    await expect(authedPage.getByText('Observações')).toHaveCount(0)
    await expect(authedPage.locator('input[name="discount"]')).toBeVisible()
  })

  // Cenário 3 — agendar sem notas.
  test('cenário 3: diálogo de agendamento sem campo de notas', async ({ org, authedPage }) => {
    seedService(org.orgId, { name: 'Corte DoD', durationMinutes: 30, priceCents: 5000 })
    seedCustomer(org.orgId, { name: `Cli Agenda ${Date.now()}` })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto()
    const newBtn = agenda.newAppointmentButton()
    await expect(newBtn).toBeEnabled()
    await newBtn.click()
    const dialog = agenda.newAppointmentDialog()
    await expect(dialog).toBeVisible()
    // Sem "Observações" no diálogo; os campos estruturados seguem.
    await expect(dialog.locator('textarea[name="notes"]')).toHaveCount(0)
    await expect(dialog.getByText('Observações')).toHaveCount(0)
    await expect(dialog.getByText('Serviço', { exact: true })).toBeVisible()
  })
})
