import { expect, test } from '../fixtures'
import { AgendaPage } from '../pages'

test.describe('Agenda — overlay de fora do expediente + editor', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('agenda esconde aviso de fora do expediente quando horários estão configurados', async ({
    authedPage,
  }) => {
    const agenda = new AgendaPage(authedPage)
    await agenda.goto()
    await expect(agenda.offHoursBanner()).toHaveCount(0)
  })

  test('detalhe da unidade renderiza o editor de horários', async ({ org, authedPage }) => {
    await authedPage.goto(`/units/${org.unitIds[0]!}`)
    await expect(
      authedPage.getByRole('group', { name: 'Como esta unidade atende?', exact: true }),
    ).toBeVisible()
  })
})
