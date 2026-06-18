import { expect, test } from '../fixtures'
import { seedBlock } from '../helpers/session'
import { AgendaPage } from '../pages'

// Retrofit pro PR #723 (issue #635) — agenda_blocks recurring + one-off.
// 2026-08-12 é uma quarta-feira (Wed) em BR. O bloco recorrente "Almoço"
// 12:00-13:00 quarta renderiza. O bloco one-off "Médico" 14:00-16:00 BR
// renderiza no mesmo dia.

test.describe('Agenda — bloqueios', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('bloco recorrente aparece no dia da semana', async ({ org, authedPage }) => {
    seedBlock({
      kind: 'recurring',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: null,
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
    // BR is UTC-3. 14:00-16:00 BR == 17:00-19:00 UTC.
    seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: null,
      startAt: '2026-08-12T17:00:00.000Z',
      endAt: '2026-08-12T19:00:00.000Z',
      reason: 'Médico',
    })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-12')
    await expect(authedPage.getByText('Médico').first()).toBeVisible()
  })

  test('bloco pontual NÃO aparece em outra data', async ({ org, authedPage }) => {
    seedBlock({
      kind: 'one_off',
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      professionalId: null,
      startAt: '2026-08-12T17:00:00.000Z',
      endAt: '2026-08-12T19:00:00.000Z',
      reason: 'Médico fora-de-data',
    })
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-13')
    await expect(authedPage.getByText('Médico fora-de-data')).toHaveCount(0)
  })
})
