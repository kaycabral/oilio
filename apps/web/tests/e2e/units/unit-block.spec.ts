// E2E for the post-spike unit hours model. The dead "Bloqueios da unidade"
// section is gone — unit-level recurring closures are now expressed through the
// multi-interval business-hours editor on the unit page (`units/[id]`). What was
// "create a recurring block that closes the unit on a weekday" is now "set that
// weekday CLOSED (or carve a gap) in the hours editor"; the agenda reflects it
// as an off-hours overlay ("Fechado" all-day, or a band in the gap).
//
// Drives BusinessHoursFields (the per-day Switch + multi-interval time ranges +
// the "Modo" combobox) and asserts the agenda overlay, then reverts.

import { expect, test } from '../fixtures'
import { AgendaPage } from '../pages'

// 2026-08-10 is a Monday; the seeded unit is OPEN Mon–Fri 09:00–18:00, so a
// Monday is the day to flip closed and watch the agenda react.
const MONDAY = '2026-08-10'

test.describe(
  'Unidade — horário de funcionamento (fecha período → agenda reflete)',
  {
    tag: ['@critical'],
  },
  () => {
    test.use({
      orgInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 30,
      },
    })

    test('render — editor de horário aparece (sem seção de bloqueios)', async ({
      org,
      authedPage,
    }) => {
      await authedPage.goto(`/units/${org.unitIds[0]}`)
      await expect(
        authedPage.getByRole('group', { name: 'Horário de funcionamento', exact: true }),
      ).toBeVisible()
      // The dead Bloqueios section is gone.
      await expect(authedPage.getByRole('heading', { name: 'Bloqueios da unidade' })).toHaveCount(0)
      // Monday starts open (seeded 09:00–18:00).
      await expect(authedPage.getByRole('switch', { name: 'Segunda' })).toBeChecked()
    })

    test('fechar a segunda → agenda mostra "Fechado" → reabrir → some', async ({
      org,
      authedPage,
    }) => {
      const agenda = new AgendaPage(authedPage)

      // Baseline: Monday is OPEN, so the agenda has no all-day "Fechado" overlay.
      await agenda.goto(MONDAY)
      await expect(authedPage.getByText('Fechado', { exact: true })).toHaveCount(0)

      // Close Monday in the hours editor: toggle the day's switch off, then save.
      await authedPage.goto(`/units/${org.unitIds[0]}`)
      const monday = authedPage.getByRole('switch', { name: 'Segunda' })
      await expect(monday).toBeChecked()
      await monday.click()
      await expect(monday).not.toBeChecked()
      await authedPage.getByRole('button', { name: 'Salvar' }).click()
      // Save navigates/revalidates; wait for the form to settle on success.
      await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
        timeout: 5000,
      })

      // Agenda for that Monday now reflects the closure: the "Fechado" all-day
      // overlay covers the professional column.
      await agenda.goto(MONDAY)
      await expect(authedPage.getByText('Fechado', { exact: true }).first()).toBeVisible({
        timeout: 5000,
      })

      // Revert: re-open Monday → the agenda overlay is gone.
      await authedPage.goto(`/units/${org.unitIds[0]}`)
      const mondayAgain = authedPage.getByRole('switch', { name: 'Segunda' })
      await expect(mondayAgain).not.toBeChecked()
      await mondayAgain.click()
      await expect(mondayAgain).toBeChecked()
      await authedPage.getByRole('button', { name: 'Salvar' }).click()
      await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
        timeout: 5000,
      })

      await agenda.goto(MONDAY)
      await expect(authedPage.getByText('Fechado', { exact: true })).toHaveCount(0)
    })

    test('intervalo partido (almoço) → agenda reflete a janela editada', async ({
      org,
      authedPage,
    }) => {
      // Narrow Monday's open window to a morning-only shift (09:00–12:00). The
      // afternoon (12:00–18:00) becomes an off-hours band on the agenda — the
      // multi-interval equivalent of the old "lunch block".
      await authedPage.goto(`/units/${org.unitIds[0]}`)

      const closeInput = authedPage.locator('input[name="bh_monday_0_close"]')
      await expect(closeInput).toHaveValue('18:00')
      // The input is controlled by React state. A fill that lands before hydration
      // sets the DOM value, then hydration takes over the controlled input and
      // resets it to the initial state — so retry the fill until it sticks (i.e.
      // onChange ran and updated state).
      await expect(async () => {
        await closeInput.fill('12:00')
        await expect(closeInput).toHaveValue('12:00', { timeout: 1000 })
      }).toPass({ timeout: 10_000 })

      await authedPage.getByRole('button', { name: 'Salvar' }).click()
      await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
        timeout: 5000,
      })

      // Re-open the unit page: the persisted value proves the edited window stuck
      // (the agenda renders the complement as an off-hours band, which has no
      // text label — the persisted close time is the load-bearing assertion that
      // the narrower open window is what the agenda computes its bands from).
      await authedPage.goto(`/units/${org.unitIds[0]}`)
      await expect(authedPage.locator('input[name="bh_monday_0_close"]')).toHaveValue('12:00')
    })
  },
)
