import { expect, test } from '../fixtures'
import { AgendaPage } from '../pages'

// Scaffold spec for the E2E retrofit (#743). Exercises the seed+session
// fixture end-to-end and asserts the agenda renders for a freshly seeded
// tenant. Read-only — does not depend on React onChange firing inside
// form-action forms (see #763).

test.describe('Agenda — com profissional aprovado e horários configurados', () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 15,
    },
  })

  test('renderiza a coluna do profissional cadastrado', async ({ authedPage }) => {
    const agenda = new AgendaPage(authedPage)
    const resp = await authedPage.goto('/agenda')
    // Diagnostic: if the layout redirected us out (login / onboarding), the
    // assertion below would say the heading is missing. Make it loud instead.
    expect(authedPage.url()).toContain('/agenda')
    expect(resp?.status()).toBeLessThan(400)
    await expect(agenda.heading()).toBeVisible()
    await expect(agenda.professionalColumn('Profissional 1')).toBeVisible()
  })
})

test.describe('Agenda — com profissional de cadastro incompleto', () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'incomplete',
      hasBusinessHours: true,
      slotMinutes: 15,
    },
  })

  test('profissional não operacional mostra chip "Cadastro incompleto"', async ({ authedPage }) => {
    const agenda = new AgendaPage(authedPage)
    await agenda.goto()
    await expect(agenda.professionalColumn('Profissional 1')).toBeVisible()
    await expect(agenda.incompleteProfileChip()).toBeVisible()
  })
})

test.describe('Agenda — sem horários configurados', () => {
  test.use({
    tenantInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
      hasBusinessHours: false,
      slotMinutes: 15,
    },
  })

  test('banner de fora do expediente aparece quando unidade não tem horários', async ({
    authedPage,
  }) => {
    const agenda = new AgendaPage(authedPage)
    await agenda.goto()
    await expect(agenda.offHoursBanner()).toBeVisible()
    await expect(agenda.configureHoursLink()).toBeVisible()
  })
})
