import { expect, test } from './fixtures'
import { addCatalogItemToOrder } from './helpers/orders'
import { choosePaymentMethod } from './helpers/select'
import {
  seedAppointment,
  seedCustomer,
  seedProduct,
  seedService,
  type SeededOrg,
} from './helpers/session'
import { AgendaPage } from './pages'

// Épico #641 — golden path do atendimento e order:
// agendamento existente → "Iniciar atendimento" → order pré-preenchida com
// serviço + executor → adiciona produto → fecha com PIX → vê comissão gerada
// E o agendamento original transiciona pra `completed`.

function seedAttendanceFixture(org: SeededOrg): void {
  // Serviço com comissão de 50% — 5000 centavos × 50% = 2500.
  const serviceId = seedService(org.orgId, {
    name: 'Corte',
    durationMinutes: 30,
    priceCents: 5000,
    commission: { kind: 'percentage', value: 50 },
  })
  seedProduct(org.orgId, { name: 'Pomada', priceCents: 3000 })
  const customerId = seedCustomer(org.orgId, {
    name: 'Cliente Order',
    whatsapp: '11988887777',
  })
  seedAppointment({
    orgId: org.orgId,
    unitId: org.unitIds[0]!,
    professionalId: org.professionalIds[0]!,
    customerId,
    serviceId,
    startAt: '2026-09-08T17:00:00.000Z',
    endAt: '2026-09-08T17:30:00.000Z',
    status: 'scheduled',
    // Snapshot mirrors the Service config above (#875). Order inicial
    // herda comissão daqui, não do Service vivo.
    servicePriceCentsSnapshot: 5000,
    serviceDurationMinutesSnapshot: 30,
    commissionSnapshot: { kind: 'percentage', value: 50 },
  })
}

test.describe('Order — caminho feliz', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('início do agendamento → adiciona produto → fecha → comissão gerada', async ({
    org,
    authedPage,
  }) => {
    seedAttendanceFixture(org)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Order/ }).click()
    await expect(authedPage.getByRole('dialog', { name: 'Editar agendamento' })).toBeVisible()

    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()

    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByRole('heading', { name: 'Cliente Order' })).toBeVisible()

    // Item pré-populado: serviço Corte com o profissional do agendamento.
    await expect(authedPage.getByText('Corte').first()).toBeVisible()
    // Total inicial = preço do serviço.
    await expect(authedPage.getByText('R$ 50,00').first()).toBeVisible()

    // Adiciona produto Pomada pelo "Adicionar item" único (#1005, AC-11) — o
    // mesmo controle escolhe serviço ou produto, kind inferido do item.
    await addCatalogItemToOrder(authedPage, 'Pomada')

    await expect(authedPage.getByText('Pomada', { exact: true })).toBeVisible()
    // Total agora = 5000 + 3000 = 8000 = R$ 80,00.
    await expect(authedPage.getByText('R$ 80,00').first()).toBeVisible()

    // Fecha com PIX — dialog de confirmação (#945) abre antes do submit final.
    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const confirmDialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(confirmDialog).toBeVisible()
    await confirmDialog.getByRole('button', { name: /Confirmar fechamento/ }).click()

    // Confirma estado pós-fechamento: comissão gerada (Corte 50% de R$ 50 = R$ 25)
    // e meio de pagamento aparece no header.
    await expect(authedPage.getByText(/comiss(ão|ões)/i).first()).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText('R$ 25,00').first()).toBeVisible()
    await expect(authedPage.getByText(/PIX/)).toBeVisible()
  })

  test('iniciar atendimento é idempotente: segundo clique reabre a mesma order', async ({
    org,
    authedPage,
  }) => {
    seedAttendanceFixture(org)
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Order/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/(.+)/)
    const firstUrl = authedPage.url()

    // Volta pra agenda e clica de novo no mesmo agendamento.
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Order/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()

    // Mesmo ID — não criou order duplicada.
    await expect(authedPage).toHaveURL(firstUrl)
  })
})
