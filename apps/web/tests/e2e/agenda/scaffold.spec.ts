import { expect, test } from '../fixtures'
import { AgendaPage } from '../pages'

test.describe('Agenda — com profissional aprovado e horários configurados', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 15,
    },
  })

  test('renderiza a coluna do profissional cadastrado', async ({ authedPage }) => {
    const agenda = new AgendaPage(authedPage)
    const resp = await authedPage.goto('/agenda')
    expect(authedPage.url()).toContain('/agenda')
    expect(resp?.status()).toBeLessThan(400)
    await expect(agenda.heading()).toBeVisible()
    await expect(agenda.memberOperationColumn('Profissional 1')).toBeVisible()
  })
})

test.describe('Agenda — com profissional de cadastro incompleto', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'incomplete',
      hasBusinessHours: true,
      slotMinutes: 15,
    },
  })

  test('profissional não operacional NÃO aparece na agenda (só em Equipe)', async ({
    authedPage,
  }) => {
    const agenda = new AgendaPage(authedPage)
    await agenda.goto()
    await expect(agenda.memberOperationColumn('Profissional 1')).toHaveCount(0)
    await expect(agenda.incompleteProfileChip()).toHaveCount(0)
  })
})

test.describe('Agenda — sem horários configurados', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
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
