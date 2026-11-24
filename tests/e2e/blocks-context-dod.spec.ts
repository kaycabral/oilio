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
    const monday = '2026-08-10'
    const agenda = new AgendaPage(authedPage)

    await authedPage.goto(`/units/${org.unitIds[0]}`)
    await expect(
      authedPage.getByRole('group', { name: 'Como esta unidade atende?', exact: true }),
    ).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Bloqueios da unidade' })).toHaveCount(0)

    await agenda.goto(monday)
    await expect(authedPage.getByText('Fechado', { exact: true })).toHaveCount(0)

    await authedPage.goto(`/units/${org.unitIds[0]}`)
    const toggle = authedPage.getByRole('switch', { name: 'Segunda' })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
      timeout: 5000,
    })

    await agenda.goto(monday)
    await expect(authedPage.getByText('Fechado', { exact: true }).first()).toBeVisible({
      timeout: 5000,
    })

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
