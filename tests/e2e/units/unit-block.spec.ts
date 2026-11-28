import { expect, test } from '../fixtures'
import { checkStable, uncheckStable } from '../helpers/hydration'
import { AgendaPage } from '../pages'

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
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
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
        authedPage.getByRole('group', { name: 'Como esta unidade atende?', exact: true }),
      ).toBeVisible()
      await expect(authedPage.getByRole('heading', { name: 'Bloqueios da unidade' })).toHaveCount(0)
      await expect(authedPage.getByRole('switch', { name: 'Segunda' })).toBeChecked()
    })

    test('fechar a segunda → agenda mostra "Fechado" → reabrir → some', async ({
      org,
      authedPage,
    }) => {
      const agenda = new AgendaPage(authedPage)

      await agenda.goto(MONDAY)
      await expect(authedPage.getByText('Fechado', { exact: true })).toHaveCount(0)

      await authedPage.goto(`/units/${org.unitIds[0]}`)
      const monday = authedPage.getByRole('switch', { name: 'Segunda' })
      await expect(monday).toBeChecked()
      await uncheckStable(monday)
      await authedPage.getByRole('button', { name: 'Salvar' }).click()
      await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
        timeout: 5000,
      })

      await agenda.goto(MONDAY)
      await expect(authedPage.getByText('Fechado', { exact: true }).first()).toBeVisible({
        timeout: 5000,
      })

      await authedPage.goto(`/units/${org.unitIds[0]}`)
      const mondayAgain = authedPage.getByRole('switch', { name: 'Segunda' })
      await expect(mondayAgain).not.toBeChecked()
      await checkStable(mondayAgain)
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
      await authedPage.goto(`/units/${org.unitIds[0]}`)

      const closeInput = authedPage.locator('input[name="bh_monday_0_close"]')
      await expect(closeInput).toHaveValue('18:00')
      await expect(async () => {
        await closeInput.fill('12:00')
        await expect(closeInput).toHaveValue('12:00', { timeout: 1000 })
      }).toPass({ timeout: 10_000 })

      await authedPage.getByRole('button', { name: 'Salvar' }).click()
      await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
        timeout: 5000,
      })

      await authedPage.goto(`/units/${org.unitIds[0]}`)
      await expect(authedPage.locator('input[name="bh_monday_0_close"]')).toHaveValue('12:00')
    })
  },
)
