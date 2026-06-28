import { expect, test } from '../fixtures'
import { AgendaPage } from '../pages'

// Retrofit pro PR #718 (issue #632) — multi-column day view.
// Read-only: seeded N profissionais aprovados devem renderizar como N
// colunas com nomes legíveis no header do grid.

test.describe('Agenda — múltiplas colunas', () => {
  test.describe('3 profissionais aprovados', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 3,
        memberOperationOperationalStatus: 'operational',
        hasBusinessHours: true,
        slotMinutes: 15,
      },
    })

    test('renderiza uma coluna por profissional aprovado', async ({ authedPage }) => {
      const agenda = new AgendaPage(authedPage)
      await agenda.goto()
      // Each name is unique (`Profissional 1`, `Profissional 2`, `Profissional 3`).
      for (const name of ['Profissional 1', 'Profissional 2', 'Profissional 3']) {
        await expect(agenda.memberOperationColumn(name)).toBeVisible()
      }
    })
  })

  test.describe('sem profissionais', () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 0,
        hasBusinessHours: true,
        slotMinutes: 15,
      },
    })

    test('mostra estado vazio quando unidade não tem profissionais', async ({ authedPage }) => {
      const agenda = new AgendaPage(authedPage)
      await agenda.goto()
      await expect(authedPage.getByText(/nenhum profissional nesta unidade/i)).toBeVisible()
    })
  })
})
