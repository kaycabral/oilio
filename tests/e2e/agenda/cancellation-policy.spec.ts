import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import {
  linkMemberOperationToServices,
  seedAppointment,
  seedCustomer,
  seedService,
  uniqueWhatsapp,
} from '../helpers/session'
import { AgendaPage, PublicBookingPage, orgSlug } from '../pages'

test.describe('Política de cancelamento — aviso na página pública', () => {
  test.describe('política habilitada', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        hasBusinessHours: true,
        slotMinutes: 30,
        cancellationPolicy: { enabled: true, minNoticeMinutes: 60 },
      },
    })

    test('aviso aparece com a antecedência configurada', async ({ org, authedPage }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: org.unitIds,
      })
      await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])
      const booking = new PublicBookingPage(authedPage, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await booking
        .slotByMemberOperation(/profissional 1/i)
        .first()
        .click()
      const notice = authedPage.getByText(/Cancelamentos pedem pelo menos/i)
      await expect(notice).toBeVisible()
      await expect(notice).toContainText(/1 hora/i)
    })
  })

  test.describe('política desabilitada', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    test('aviso fica ausente', async ({ org, authedPage }) => {
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: org.unitIds,
      })
      await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])
      const booking = new PublicBookingPage(authedPage, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await booking
        .slotByMemberOperation(/profissional 1/i)
        .first()
        .click()
      await expect(authedPage.getByText(/Cancelamentos pedem pelo menos/i)).toHaveCount(0)
    })
  })
})

test.describe('Não-comparecimento — marcar e desmarcar', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('round-trip mark + unmark via diálogo de edição', async ({ org, authedPage }) => {
    const serviceId = await seedService(org.orgId, {
      name: 'Corte',
      durationMinutes: 30,
      priceCents: 5000,
    })
    const customerId = await seedCustomer(org.orgId, {
      name: 'Cliente NoShow',
      mobile: uniqueWhatsapp(),
    })
    await seedAppointment({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: org.memberOperationIds[0]!,
      customerId,
      serviceId,
      startAt: '2024-01-16T13:00:00.000Z',
      endAt: '2024-01-16T13:30:00.000Z',
      status: 'scheduled',
    })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2024-01-16')

    await authedPage.getByRole('button', { name: /Cliente NoShow/ }).click()
    const dialog = authedPage.getByRole('dialog', { name: 'Editar agendamento' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: /^marcar não compareceu$/i }).click()
    await expect(dialog).toBeHidden()

    await authedPage.getByRole('button', { name: /Cliente NoShow/ }).click()
    const dialog2 = authedPage.getByRole('dialog', { name: 'Editar agendamento' })
    await expect(dialog2.getByRole('button', { name: /^desmarcar não compareceu$/i })).toBeVisible()
    await expect(dialog2.getByRole('button', { name: /^marcar não compareceu$/i })).toHaveCount(0)
    await expect(dialog2.getByRole('button', { name: /^cancelar agendamento$/i })).toHaveCount(0)

    await dialog2.getByRole('button', { name: /^desmarcar não compareceu$/i }).click()
    await expect(dialog2).toBeHidden()
  })
})
