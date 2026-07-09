import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { fillBirthDate } from '../helpers/forms'
import {
  linkMemberOperationToServices,
  pgListByOrg,
  seedAuthUser,
  seedService,
  signInAndAttachSession,
} from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

async function listCustomers(orgId: string): Promise<Array<{ userId?: string }>> {
  const rows = await pgListByOrg('customers', orgId)
  return rows.map((r) => ({ userId: typeof r.user_id === 'string' ? r.user_id : undefined }))
}

test.describe('brief 0077 — Feature-level DoD', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test('Cenário 1 — visitante anônimo no confirm é mandado pro login', async ({ org, page }) => {
    const slug = orgSlug(org.orgId)
    const unitId = org.unitIds[0]!
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Anon',
      durationMinutes: 30,
      publicVisible: true,
      unitIds: [unitId],
    })
    await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

    const start = `${nextWeekday('Wed')}T17:00:00.000Z`
    const params = new URLSearchParams({
      service: serviceId,
      memberOperation: org.memberOperationIds[0]!,
      start,
    })
    const booking = new PublicBookingPage(page, slug)
    await page.goto(`/${slug}/unidade-1/book?${params.toString()}`)
    await expect(booking.confirmHeading()).toBeVisible()
    await booking.confirmButton().click()
    await page.waitForURL(/\/login\?next=/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login\?next=/)
  })

  test('Cenário 2 — recepção convida sem digitar PII do cliente', async ({ authedPage }) => {
    await authedPage.goto('/customers')
    await authedPage.getByRole('button', { name: 'Convidar cliente' }).click()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Convidar cliente' })).toBeVisible()
    await expect(dialog.locator('input[name="name"]')).toHaveCount(0)
    await expect(dialog.locator('input[name="email"]')).toHaveCount(0)
    await expect(dialog.locator('input[name="birthDate"]')).toHaveCount(0)
    await dialog.locator('input[name="whatsapp"]').fill(`119${String(Date.now()).slice(-8)}`)
    await expect(dialog.getByRole('textbox', { name: 'Link do convite' })).toHaveValue(
      /\/signup\?.*from=/,
    )
  })

  test('Cenário 5 — logado mas incompleto é mandado completar antes de agendar', async ({
    org,
    context,
    page,
    baseURL,
  }) => {
    const slug = orgSlug(org.orgId)
    const unitId = org.unitIds[0]!
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Incompleto',
      durationMinutes: 30,
      publicVisible: true,
      unitIds: [unitId],
    })
    await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

    const visitor = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, visitor.email, visitor.password, baseURL ?? undefined)

    const start = `${nextWeekday('Wed')}T17:00:00.000Z`
    const params = new URLSearchParams({
      service: serviceId,
      memberOperation: org.memberOperationIds[0]!,
      start,
    })
    const booking = new PublicBookingPage(page, slug)
    await page.goto(`/${slug}/unidade-1/book?${params.toString()}`)
    await booking.confirmButton().click()
    await page.waitForURL(/\/onboarding\/profile\?next=/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/onboarding\/profile\?next=/)
  })

  test('Cenário 6 — contexto adulterado cai em signup de plataforma (sem Customer no org)', async ({
    org,
    context,
    page,
    baseURL,
  }) => {
    const visitor = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, visitor.email, visitor.password, baseURL ?? undefined)

    const tampered = '/signup/done?from=slug-que-nao-existe-99999'
    await page.goto(`/onboarding/profile?next=${encodeURIComponent(tampered)}`)
    await page
      .getByRole('textbox', { name: /whatsapp/i })
      .fill(`119${String(Date.now()).slice(-8)}`)
    await fillBirthDate(page, '15/03/1992')
    await page.getByRole('button', { name: /continuar/i }).click()

    await page.waitForURL(/\/signup\/done/, { timeout: 10_000 })

    const customers = await listCustomers(org.orgId)
    expect(customers.filter((c) => c.userId === visitor.uid)).toHaveLength(0)
  })
})
