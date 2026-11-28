import { expect, test } from '../fixtures'
import { checkStable, fillStable } from '../helpers/hydration'
import { expectHttpNotFound } from '../helpers/not-found'
import { linkMemberOperationToServices, seedService } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

const INTERNAL_ROUTES = [
  '/dashboard',
  '/organizations',
  '/catalog',
  '/team',
  '/customers',
  '/plans',
] as const

test.describe('Feature 0008 — Definition of Done (onboarding just-in-time)', () => {
  test.describe('org mínimo (1ª unidade criada, sem mais cadastros)', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 0 } })

    test('Cenário 1: app operável sem gate global de setup', async ({ authedPage }) => {
      for (const route of INTERNAL_ROUTES) {
        await authedPage.goto(route)

        await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
        await expect(authedPage).not.toHaveURL(/\/login(\/|$)/)

        await expect(authedPage).toHaveURL(new RegExp(`${route}(/|\\?|$)`))
        await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()
      }

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda(\/|\?|$)/)
    })

    test('Cenário 2: empty-state leva ao fluxo real (convite contextual pela UI)', async ({
      authedPage,
    }) => {
      await authedPage.goto('/customers')
      await expect(authedPage.getByText(/nenhum cliente/i)).toBeVisible()
      const cta = authedPage.getByRole('button', { name: 'Convidar cliente' })
      await expect(cta).toBeVisible()

      await cta.click()
      const dialog = authedPage.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: 'Convidar cliente' })).toBeVisible()

      await fillStable(
        dialog.locator('input[name="whatsapp"]'),
        `119${Date.now().toString().slice(-8)}`,
      )
      await expect(dialog.getByRole('textbox', { name: 'Link do convite' })).toHaveValue(
        /\/signup\?/,
      )
      await expect(dialog.getByRole('button', { name: /abrir no whatsapp/i })).toBeVisible()
    })
  })

  test.describe('org incompleto (não publicável)', () => {
    test.use({
      orgInput: { hasBusinessHours: false, memberOperationCount: 0 },
    })

    test('Cenário 3: unidade fica fora do público até atender o mínimo (sem horário → 404)', async ({
      org,
      authedPage,
      page,
    }) => {
      await authedPage.goto(`/units/${org.unitIds[0]}`)

      await expect(authedPage.getByText('Agendamento público desta unidade')).toBeVisible()
      await expect(authedPage.getByText(/fica visível automaticamente/i)).toBeVisible()
      const checklist = authedPage.locator('[data-slot="unit-agenda-readiness"]')
      await expect(
        checklist.getByText('Endereço e horário de funcionamento preenchidos'),
      ).toBeVisible()
      await expect(checklist.getByText('1 serviço público oferecido nesta unidade')).toBeVisible()

      await authedPage.goto('/catalog')
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      await expectHttpNotFound(page, `/${orgSlug(org.orgId)}`)
    })
  })

  test.describe('org pronto pra publicar', () => {
    test.use({
      orgInput: {
        hasBusinessHours: false,
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'operational',
      },
    })

    test('Cenário 4: completar o mínimo da unidade → página pública no ar', async ({
      org,
      authedPage,
      page,
    }) => {
      const slug = orgSlug(org.orgId)
      const unitId = org.unitIds[0]!

      const serviceId = await seedService(org.orgId, {
        name: 'Corte DoD',
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
      await fillStable(authedPage.locator('input[name="postalCode"]'), '01310100')
      await authedPage.locator('input[name="number"]').fill('123')
      await checkStable(authedPage.getByRole('switch', { name: 'Segunda', exact: true }))
      await authedPage.getByRole('button', { name: 'Salvar' }).click()
      await authedPage.waitForURL('**/organizations')

      await authedPage.goto(`/units/${unitId}`)
      await expect(authedPage.getByText(/no ar — clientes já podem agendar/i)).toBeVisible({
        timeout: 5000,
      })

      const booking = new PublicBookingPage(page, slug)
      const after = await page.goto(`/${slug}/unidade-1`)
      expect(after?.status()).toBe(200)
      await expect(booking.serviceCard('Corte DoD')).toBeVisible()
    })
  })
})
