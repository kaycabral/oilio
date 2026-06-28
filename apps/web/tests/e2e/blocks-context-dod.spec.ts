// Feature-level E2E for brief 0036 — "Matar /blocks: bloqueio no contexto
// responsável" (parent #1080), updated for the hours-model spike. The shared
// block machinery now has ONE home (the member detail). Unit-wide recurring
// closures moved out of the dead "Bloqueios da unidade" section into the
// multi-interval business-hours editor on the unit page — so Cenário 1 now
// exercises CLOSING a weekday in the hours editor and the agenda reflecting it.
//
// DoD § brief 0036 (post-spike):
//   Cenário 1 — fechar um dia no horário da unidade (units/[id]) → a agenda
//               reflete a unidade fechada (overlay "Fechado").
//   Cenário 2 — bloqueio de profissional no detalhe do membro (/team/[userId])
//               → memberOperationId set; só a coluna dele.
//   Cenário 3 — /blocks não existe (404; nav sem "Bloqueios").

import { expect, test } from './fixtures'
import { AgendaPage, MemberOperationsPage } from './pages'

test.describe('Bloqueio no contexto — Feature DoD (brief 0036 · #1080)', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('Cenário 1 — fechar a unidade num dia (horário) → a agenda reflete → reabrir', async ({
    org,
    authedPage,
  }) => {
    // 2026-08-10 is a Monday; the seeded unit is OPEN Mon–Fri 09:00–18:00.
    const monday = '2026-08-10'
    const agenda = new AgendaPage(authedPage)

    // The unit page renders the hours editor — no more "Bloqueios da unidade".
    await authedPage.goto(`/units/${org.unitIds[0]}`)
    await expect(
      authedPage.getByRole('group', { name: 'Horário de funcionamento', exact: true }),
    ).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Bloqueios da unidade' })).toHaveCount(0)

    // Baseline: Monday is open, agenda has no all-day "Fechado" overlay.
    await agenda.goto(monday)
    await expect(authedPage.getByText('Fechado', { exact: true })).toHaveCount(0)

    // Close Monday in the hours editor and save.
    await authedPage.goto(`/units/${org.unitIds[0]}`)
    const toggle = authedPage.getByRole('switch', { name: 'Segunda' })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
      timeout: 5000,
    })

    // The agenda reflects the closed unit on that Monday.
    await agenda.goto(monday)
    await expect(authedPage.getByText('Fechado', { exact: true }).first()).toBeVisible({
      timeout: 5000,
    })

    // Revert: re-open Monday → the overlay is gone.
    await authedPage.goto(`/units/${org.unitIds[0]}`)
    const toggleAgain = authedPage.getByRole('switch', { name: 'Segunda' })
    await expect(toggleAgain).not.toBeChecked()
    await toggleAgain.click()
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
      timeout: 5000,
    })
    await agenda.goto(monday)
    await expect(authedPage.getByText('Fechado', { exact: true })).toHaveCount(0)
  })

  test('Cenário 2 — bloqueio do profissional no detalhe do membro → reflete na agenda', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const reason = `Folga Pro ${ts}`
    const section = authedPage.getByRole('region', { name: 'Bloqueios do profissional' })
    const pros = new MemberOperationsPage(authedPage)

    await pros.gotoById(org.memberOperationIds[0]!)
    await expect(
      authedPage.getByRole('heading', { name: 'Bloqueios do profissional' }),
    ).toBeVisible()

    await section.getByRole('button', { name: 'Novo bloqueio' }).click()
    await section.locator('input[name="reason"]').fill(reason)
    await section.getByRole('button', { name: 'Criar' }).click()
    await expect(section.getByText(reason, { exact: true })).toBeVisible({ timeout: 5000 })

    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-10')
    await expect(authedPage.getByText(reason).first()).toBeVisible({ timeout: 5000 })
  })

  test('Cenário 3 — /blocks não existe (404) e a nav não oferece "Bloqueios"', async ({
    authedPage,
  }) => {
    const res = await authedPage.goto('/blocks')
    expect(res?.status()).toBe(404)
    await authedPage.goto('/agenda')
    await expect(authedPage.getByRole('link', { name: 'Bloqueios' })).toHaveCount(0)
  })
})
