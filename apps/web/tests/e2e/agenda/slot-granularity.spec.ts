import { expect, test } from '../fixtures'
import { AgendaPage } from '../pages'

// Retrofit pro PR #721 (issue #633) — slot granularity é config da agenda
// (movida do /company no #746). Owner/manager troca o select "Slots" no
// header e a org.slotMinutes persiste; non-manager não vê o select.

test.describe('Agenda — granularidade de slots', () => {
  test.describe('valor cadastrado reflete na UI', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    test('owner vê o select com valor da empresa', async ({ authedPage }) => {
      const agenda = new AgendaPage(authedPage)
      await agenda.goto()
      const slotSelect = authedPage.getByRole('combobox', { name: 'Slots' })
      await expect(slotSelect).toBeVisible()
      // Seeded slotMinutes=30 should be the selected option (trigger shows its text).
      await expect(slotSelect).toHaveText('30 min')
    })
  })

  test.describe('opções canônicas', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 15,
      },
    })

    test('select renderiza todas as opções canônicas', async ({ authedPage }) => {
      const agenda = new AgendaPage(authedPage)
      await agenda.goto()
      // Radix Select só renderiza as options no portal quando aberto.
      await authedPage.getByRole('combobox', { name: 'Slots' }).click()
      // SLOT_MINUTES_OPTIONS in @/domain (= [5, 10, 15, 30]).
      await expect(authedPage.getByRole('option')).toHaveText([
        '5 min',
        '10 min',
        '15 min',
        '30 min',
      ])
    })
  })
})

// The select onChange → server action persistence path needs a Playwright
// `selectOption` to fire React's synthetic onChange in dev mode. That race
// is tracked in #763 and not covered here. The persistence logic itself is
// exercised through the `updateAgendaSlotMinutes` server action by future
// integration tests when emulator-backed integration scaffolding lands.
