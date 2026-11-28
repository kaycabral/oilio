import { expect, test } from '../fixtures'
import { checkStable, fillStable } from '../helpers/hydration'
import { expectHttpNotFound } from '../helpers/not-found'
import { linkMemberOperationToServices, seedService } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe('Publish self-booking — happy path (#988)', { tag: '@critical' }, () => {
  test.use({
    orgInput: {
      hasBusinessHours: false,
      unitCount: 1,
      memberOperationCount: 1,
      memberOperationOperationalStatus: 'operational',
    },
  })

  test('AC-07/AC-08: filling the unit hours makes it bookable → public page live', async ({
    org,
    authedPage,
    page,
  }) => {
    const slug = orgSlug(org.orgId)
    const unitId = org.unitIds[0]!

    const serviceId = await seedService(org.orgId, {
      name: 'Corte Publicado',
      priceCents: 5000,
      publicVisible: true,
      unitIds: [unitId],
    })
    await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

    await expectHttpNotFound(page, `/${slug}/unidade-1`)

    await authedPage.route('**/api/postal-code/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          postalCode: '01310100',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Bela Vista',
          street: 'Avenida Paulista',
        }),
      }),
    )

    await authedPage.goto(`/units/${unitId}`)

    await expect(authedPage.getByText('Agendamento público desta unidade')).toBeVisible()
    await expect(authedPage.getByText(/fica visível automaticamente/i)).toBeVisible()

    await fillStable(authedPage.locator('input[name="postalCode"]'), '01310100')
    await fillStable(authedPage.locator('input[name="number"]'), '123')

    await checkStable(authedPage.getByRole('switch', { name: 'Segunda', exact: true }))
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage.getByRole('button', { name: 'Salvando…' })).toHaveCount(0, {
      timeout: 10_000,
    })

    await authedPage.goto(`/units/${unitId}`)
    await expect(authedPage.getByText(/no ar — clientes já podem agendar/i)).toBeVisible({
      timeout: 5000,
    })

    const booking = new PublicBookingPage(page, slug)
    const after = await page.goto(`/${slug}/unidade-1`)
    expect(after?.status()).toBe(200)
    await expect(booking.serviceCard('Corte Publicado')).toBeVisible()
  })
})
