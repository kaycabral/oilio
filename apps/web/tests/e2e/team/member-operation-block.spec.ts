// E2E for #1082 (brief 0036) — a memberOperation's own blocks now live in the
// member detail (`/team/[userId]`), next to the operational config. Baseline
// UI/CRUD: render+empty · criar pelo fluxo real → reflete na agenda → editar →
// excluir.
//
// AC-03 [critical] [smoke] — CRUD de bloqueio do profissional (`memberOperationId`
//   set) no detalhe do membro; só a coluna dele é bloqueada na agenda.

import { expect, test } from '../fixtures'
import { AgendaPage, MemberOperationsPage } from '../pages'

test.describe('Equipe — bloqueios do profissional (#1082)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
      hasBusinessHours: true,
      slotMinutes: 30,
    },
  })

  test('render + empty state na seção de bloqueios do profissional', async ({
    org,
    authedPage,
  }) => {
    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoById(org.memberOperationIds[0]!)
    await expect(
      authedPage.getByRole('heading', { name: 'Bloqueios do profissional' }),
    ).toBeVisible()
    await expect(
      authedPage
        .getByRole('region', { name: 'Bloqueios do profissional' })
        .getByText('Nenhum bloqueio cadastrado'),
    ).toBeVisible()
  })

  test('criar pelo fluxo real → reflete na agenda (coluna do pro) → editar → excluir', async ({
    org,
    authedPage,
  }) => {
    authedPage.on('dialog', (d) => d.accept())
    const ts = Date.now().toString()
    const reason = `Folga ${ts}`
    const edited = `${reason} Editado`
    const section = authedPage.getByRole('region', { name: 'Bloqueios do profissional' })
    const pros = new MemberOperationsPage(authedPage)

    await pros.gotoById(org.memberOperationIds[0]!)

    // Criar — recorrente (default segunda 12:00–13:00).
    await section.getByRole('button', { name: 'Novo bloqueio' }).click()
    await section.locator('input[name="reason"]').fill(reason)
    await section.getByRole('button', { name: 'Criar' }).click()
    await expect(section.getByText(reason, { exact: true })).toBeVisible({ timeout: 5000 })

    // Reflete na agenda numa segunda (2026-08-10) — bloqueio do profissional.
    const agenda = new AgendaPage(authedPage)
    await agenda.goto('2026-08-10')
    await expect(authedPage.getByText(reason).first()).toBeVisible({ timeout: 5000 })

    // Editar in-place.
    await pros.gotoById(org.memberOperationIds[0]!)
    await section.locator('li', { hasText: reason }).getByRole('button', { name: 'Editar' }).click()
    await section.locator('input[name="reason"]').fill(edited)
    await section.getByRole('button', { name: 'Salvar' }).click()
    await expect(section.getByText(edited, { exact: true })).toBeVisible({ timeout: 5000 })

    // Excluir.
    await section
      .locator('li', { hasText: edited })
      .getByRole('button', { name: 'Excluir' })
      .click()
    await expect(section.getByText(edited, { exact: true })).toBeHidden({ timeout: 5000 })
  })
})
