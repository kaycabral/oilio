import { expect, test } from '../fixtures'
import { expectHttpNotFound } from '../helpers/not-found'
import { orgSlug } from '../pages'

test.describe(
  'Publish self-booking — not bookable without the minimum (#988)',
  { tag: '@critical' },
  () => {
    test.use({
      orgInput: {
        hasBusinessHours: false,
        memberOperationCount: 0,
      },
    })

    test('AC-06: the per-unit readiness card lists the missing items', async ({
      org,
      authedPage,
    }) => {
      await authedPage.goto(`/units/${org.unitIds[0]!}`)

      await expect(authedPage.getByText('Agendamento público desta unidade')).toBeVisible()

      await expect(authedPage.getByText(/fica visível automaticamente/i)).toBeVisible()

      const checklist = authedPage.locator('[data-slot="unit-agenda-readiness"]')
      await expect(
        checklist.getByText('Endereço e horário de funcionamento preenchidos'),
      ).toBeVisible()
      await expect(checklist.getByText('1 serviço público oferecido nesta unidade')).toBeVisible()
      await expect(checklist.getByText('1 profissional aprovado nesta unidade')).toBeVisible()
    })

    test('AC-08 (negative): the public page does not resolve while the unit is not bookable', async ({
      org,
      page,
    }) => {
      const slug = orgSlug(org.orgId)

      await expectHttpNotFound(page, `/${slug}`)
      await expectHttpNotFound(page, `/${slug}/unidade-1`)
    })
  },
)
