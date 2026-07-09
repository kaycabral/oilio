import { expect, test } from '../fixtures'
import { seedBlock } from '../helpers/session'
import { AgendaPage } from '../pages'

test.describe('Agenda — bloqueios', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('bloco recorrente aparece no dia da semana', async ({ org, authedPage }) => {
    await seedBlock({
      kind: 'recurring',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: null,
      weekday: 'wednesday',
      open: '12:00',
      close: '13:00',
      reason: 'Almoço',
    })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await expect(authedPage.getByText('Almoço').first()).toBeVisible()
  })

  test('bloco pontual aparece na data específica', async ({ org, authedPage }) => {
    await seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: null,
      startAt: '2026-08-12T17:00:00.000Z',
      endAt: '2026-08-12T19:00:00.000Z',
      reason: 'Médico',
    })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await expect(authedPage.getByText('Médico').first()).toBeVisible()
  })

  test('bloco pontual NÃO aparece em outra data', async ({ org, authedPage }) => {
    await seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      memberOperationId: null,
      startAt: '2026-08-12T17:00:00.000Z',
      endAt: '2026-08-12T19:00:00.000Z',
      reason: 'Médico fora-de-data',
    })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-13')
    await expect(authedPage.getByText('Médico fora-de-data')).toHaveCount(0)
  })
})
