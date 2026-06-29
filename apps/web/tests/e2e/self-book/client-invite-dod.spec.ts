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

// Feature-level E2E — brief 0077 § Definition of Done (#1273). One test() per DoD
// scenario the other specs don't already own:
//   - Cenário 1 — agendar via link/QR EXIGE login (anônimo é barrado).
//   - Cenário 2 — estabelecimento convida sem digitar PII do cliente.
//   - Cenário 5 — cadastro completo é invariante (camada da action/UI: logado
//     mas incompleto é mandado completar antes de agendar).
//   - Cenário 6 — contexto adulterado é rejeitado (slug inválido → fallback
//     silencioso pra signup de plataforma, sem materializar Customer no org).
//
// Cenário 3 (materialização) vive em `signup/self-signup.spec.ts` +
// `onboarding/.../complete-profile-materialize.events.pg.integration.test.ts`;
// Cenário 4 (anti-double-book) em `landing-public/booking-double-book.spec.ts`.

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

    // Anônimo (sem authedPage) tenta confirmar via URL direta com contexto.
    const start = `${nextWeekday('Wed')}T17:00:00.000Z`
    const params = new URLSearchParams({
      service: serviceId,
      memberOperation: org.memberOperationIds[0]!,
      start,
    })
    const booking = new PublicBookingPage(page, slug)
    await page.goto(`/${slug}/unidade-1/book?${params.toString()}`)
    await expect(booking.confirmHeading()).toBeVisible()
    // O CTA reflete o login-first pra quem não está logado.
    await booking.confirmButton().click()
    // Nobody agenda sem login: rota pro /login preservando o destino.
    await page.waitForURL(/\/login\?next=/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/login\?next=/)
  })

  test('Cenário 2 — recepção convida sem digitar PII do cliente', async ({ authedPage }) => {
    await authedPage.goto('/customers/new')
    await expect(authedPage.getByRole('heading', { name: 'Convidar cliente' })).toBeVisible()
    // Só o WhatsApp — nenhum nome/email/nascimento do cliente é tipado aqui.
    await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
    await expect(authedPage.locator('input[name="birthDate"]')).toHaveCount(0)
    await authedPage.locator('input[name="whatsapp"]').fill(`119${String(Date.now()).slice(-8)}`)
    await authedPage.getByRole('button', { name: /enviar convite/i }).click()
    // Devolve o link contextual (signup com `from`) — sem criar Customer.
    await expect(authedPage.getByText(/convite gerado/i)).toBeVisible({ timeout: 5000 })
    await expect(authedPage.getByText(/\/signup\?.*from=/)).toBeVisible()
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

    // Usuário logado mas SEM cadastro completo (completionCompleted=false).
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
    // A camada de action recusa (needs-completion) → UI manda completar cadastro.
    await page.waitForURL(/\/onboarding\/profile\?next=/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/onboarding\/profile\?next=/)
  })

  test('Cenário 6 — contexto adulterado cai em signup de plataforma (sem Customer no org)', async ({
    org,
    context,
    page,
    baseURL,
  }) => {
    // Usuário logado e incompleto completa o cadastro, mas o `next` aponta pra um
    // slug que NÃO existe — o resolvedor de contexto descarta, então nenhum
    // Customer é materializado no org real (nem em lugar nenhum).
    const visitor = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, visitor.email, visitor.password, baseURL ?? undefined)

    const tampered = '/signup/done?from=slug-que-nao-existe-99999'
    await page.goto(`/onboarding/profile?next=${encodeURIComponent(tampered)}`)
    // Identity already supplied the name (seedAuthUser sets displayName), so the
    // form confirms it — only whatsapp + birthDate are asked.
    await page
      .getByRole('textbox', { name: /whatsapp/i })
      .fill(`119${String(Date.now()).slice(-8)}`)
    await fillBirthDate(page, '15/03/1992')
    await page.getByRole('button', { name: /continuar/i }).click()

    // Completion redirects to the (tampered) done URL — wait for the navigation
    // off the profile page so materialization has run.
    await page.waitForURL(/\/signup\/done/, { timeout: 10_000 })

    // O org real seedado NÃO ganhou Customer — o contexto adulterado foi rejeitado.
    const customers = await listCustomers(org.orgId)
    expect(customers.filter((c) => c.userId === visitor.uid)).toHaveLength(0)
  })
})
