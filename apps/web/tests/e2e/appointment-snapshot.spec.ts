import { expect, test } from './fixtures'
import { choosePaymentMethod } from './helpers/select'
import {
  patchAppointmentSnapshot,
  seedAppointment,
  seedCustomer,
  seedService,
} from './helpers/session'
import { AgendaPage, ServicesPage } from './pages'

// Coverage for #875 — Appointment snapshot. After a Service price change,
// the existing appointment's order uses the OLD price (snapshot), not the
// live Service value. Guarantees financial history doesn't mutate
// retroactively when the owner edits pricing.

test.describe('Snapshot do agendamento', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('order iniciada de Agendamento usa preço do snapshot, não do Serviço vivo', async ({
    org,
    authedPage,
  }) => {
    // Serviço criado com preço R$ 50,00 — vai virar o SNAPSHOT do appointment.
    const serviceId = await seedService(org.orgId, {
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 5000,
      unitIds: org.unitIds,
    })
    const customerId = await seedCustomer(org.orgId, {
      name: 'Cliente Snapshot',
      whatsapp: '11988887777',
    })
    // Appointment seeded with snapshot = 5000 cents (booking-time price).
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
      commissionSnapshot: null,
    })

    // Owner muda o preço do Service ANTES de abrir a order. Sem snapshot,
    // a order mostraria o preço novo. Com snapshot, ela mostra o original.
    const services = new ServicesPage(authedPage)
    await services.gotoById(serviceId)
    await authedPage.getByRole('textbox', { name: 'Preço (R$)' }).fill('999,00')
    // Service items live in the unified /catalog now (brief 0023, #1005); the
    // shared form's submit button is `type=submit` and on success the client
    // navigates back to the catalog index.
    await authedPage.locator('form').getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/catalog$/)

    // Abre a order a partir do appointment.
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Snapshot/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)

    // Snapshot venceu: total da order = R$ 50,00 (não R$ 999,00).
    // (O dropdown único "Adicionar item" (#1005) lista o preço atual do item,
    // que reflete o resolveCatalogItemForUnit live — isso é intencional pra
    // itens novos. O que importa é o item PRÉ-POPULADO + total snapshotados.)
    await expect(authedPage.getByText('Corte').first()).toBeVisible()
    // The seeded item line `1 × R$ 50,00` is the snapshot evidence. The
    // unified dropdown "Selecione item… / Corte · serviço · R$ 999,00" shows
    // the live price (correct for adding NEW items) — that's by design.
    await expect(authedPage.getByText('1 × R$ 50,00')).toBeVisible()
    await expect(authedPage.getByText('1 × R$ 999,00')).toHaveCount(0)
  })

  // Regression for #1037 (ES-seletivo, frente B) — no-drift between appointment
  // and its order. `startAttendance` value-copies the appointment's snapshot
  // (price + commission) into the OrderItem at order creation; the appointment
  // is never re-read and the OrderItem is immutable after `order.created`. So
  // editing the appointment AFTER the order exists must NOT change the order.
  // This proves it on the money path: the order total + the generated commission
  // stay on the LOCKED snapshot (P1/C1), not the drifted appointment (P2/C2).
  test('editar o agendamento depois da order não muda total nem comissão da order', async ({
    org,
    authedPage,
  }) => {
    // P1 = R$ 50,00, C1 = 50% → comissão travada = R$ 25,00.
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Sem Drift',
      durationMinutes: 30,
      priceCents: 5000,
      commission: { kind: 'percentage', value: 50 },
      unitIds: org.unitIds,
    })
    const customerId = await seedCustomer(org.orgId, {
      name: 'Cliente Drift',
      whatsapp: '11955552222',
    })
    const appointmentId = await seedAppointment({
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

    // Abre a order a partir do appointment — o OrderItem trava P1/C1 por cópia
    // de valor (startAttendance, actions.ts ~L113).
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-09-08')
    await authedPage.getByRole('button', { name: /Cliente Drift/ }).click()
    await authedPage.getByRole('button', { name: /Iniciar atendimento/ }).click()
    await expect(authedPage).toHaveURL(/\/orders\/.+/)
    await expect(authedPage.getByText('1 × R$ 50,00')).toBeVisible()

    // O agendamento DERIVA: snapshot vira P2 = R$ 999,00 / C2 = 10% — espelha o
    // que `updateAppointment` grava ao trocar serviço/unidade depois do booking.
    // A order já tem sua própria cópia: não deve seguir o drift.
    await patchAppointmentSnapshot(org.orgId, appointmentId, {
      servicePriceCentsSnapshot: 99900,
      commissionSnapshot: { kind: 'percentage', value: 10 },
    })

    // Fecha a order (paga em pix → gera comissão).
    await choosePaymentMethod(authedPage, 'pix')
    await authedPage.getByRole('button', { name: /Fechar venda/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Confirmar fechamento' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /Confirmar fechamento/ }).click()
    await expect(authedPage.getByText(/Fechada em/)).toBeVisible({ timeout: 5000 })

    // Total + comissão usam P1/C1 (snapshot travado da order), NÃO P2/C2 (drift).
    const commissionSection = authedPage
      .locator('section')
      .filter({ has: authedPage.getByRole('heading', { name: 'Comissões geradas' }) })
    await expect(commissionSection).toBeVisible()
    await expect(commissionSection.getByText('· Corte Sem Drift')).toBeVisible()
    // 50% de R$ 50,00 = R$ 25,00 (não 10% de R$ 999,00 = R$ 99,90).
    await expect(commissionSection.getByText('R$ 25,00').first()).toBeVisible()
    await expect(authedPage.getByText('R$ 99,90')).toHaveCount(0)
    await expect(authedPage.getByText('R$ 999,00')).toHaveCount(0)

    // Projeção `/reports/commissions`: a comissão travada (P1/C1) é a que conta.
    await authedPage.goto('/reports/commissions')
    const commissionRow = authedPage.getByRole('listitem').filter({ hasText: 'Corte Sem Drift' })
    await expect(commissionRow).toBeVisible()
    await expect(commissionRow.getByText('R$ 25,00')).toBeVisible()
    await expect(commissionRow.getByText('R$ 99,90')).toHaveCount(0)
  })
})
