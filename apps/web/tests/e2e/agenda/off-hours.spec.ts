import { expect, test } from '../fixtures'
import { AgendaPage } from '../pages'

// Retrofit pro PR #722 (issue #634) — off-hours overlay na agenda +
// editor de business-hours na rota /units/[id]. As bandas escurecidas em
// si são overlays decorativos sem texto (selector-policy violations); o
// que dá pra checar de forma user-visible é (a) o banner de aviso some
// quando a unit tem businessHours configurado (positivo já coberto em
// agenda-scaffold.spec.ts), e (b) o fieldset do editor renderiza em
// /units/[id].

test.describe('Agenda — overlay de fora do expediente + editor', () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      professionalOperationalStatus: 'operational',
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
    // <legend> rendered as the fieldset's accessible name.
    await expect(
      authedPage.getByRole('group', { name: 'Horário de funcionamento', exact: true }),
    ).toBeVisible()
  })
})
