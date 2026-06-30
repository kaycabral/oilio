import { expect, test } from '../fixtures'
import { fillBirthDate, isoToBrDate } from '../helpers/forms'
import {
  readUser,
  seedAuthUser,
  seedInvite,
  seedOrg,
  signInAndAttachSession,
  uniqueNationalWhatsapp,
} from '../helpers/session'

// #838 — completion step pós-OAuth: every newly-OAuth'd user lands on
// /onboarding/profile and must capture whatsapp + birthDate before any
// other app surface unlocks.

test.describe('Onboarding — conclusão de perfil', () => {
  test('owner sem perfil completo é mandado pra /onboarding/profile e libera o wizard após salvar', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, owner.email, owner.password, baseURL ?? undefined)

    // /onboarding is the post-login default for users without a org; the
    // page itself enforces the completion gate.
    await page.goto('/onboarding')
    await expect(page).toHaveURL(/\/onboarding\/profile/)
    await expect(page.getByRole('heading', { name: /completar seu cadastro/i })).toBeVisible()

    // The identity (seedAuthUser sets displayName) already gave us the name, so
    // the form confirms it instead of re-asking — only whatsapp + birthDate left.
    await expect(page.getByText(/você é/i)).toBeVisible()
    await expect(page.getByRole('textbox', { name: /nome/i })).toHaveCount(0)
    await page.getByRole('textbox', { name: /whatsapp/i }).fill(uniqueNationalWhatsapp())
    await fillBirthDate(page, '15/04/1990')
    await page.getByRole('button', { name: /continuar/i }).click()

    // Default `next` is /dashboard, but the user has no org — `/onboarding`
    // is where the membership-check would send them. We just need to leave
    // /onboarding/profile and not be sent back.
    await expect(page).not.toHaveURL(/\/onboarding\/profile/)
    const u = await readUser(owner.uid)
    expect(u).not.toBeNull()
    expect(u!.completionCompleted).toBe(true)
  })

  test('usuário já completo não é re-perguntado (gate idempotente)', async ({
    context,
    page,
    baseURL,
  }) => {
    // seedOrg pre-fills completionCompleted=true on the owner user doc.
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

    // /dashboard renders directly — no bounce through /onboarding/profile.
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('WhatsApp inválido é rejeitado (gate client-side)', async ({ context, page, baseURL }) => {
    const owner = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, owner.email, owner.password, baseURL ?? undefined)

    await page.goto('/onboarding/profile')
    // Name comes from the identity (confirmed, not re-asked) — gate hinges on
    // the masked WhatsApp below.
    // Typing non-digits into the masked PhoneInput yields an EMPTY value, so the
    // required field fails client validation and `Continuar` stays disabled (the
    // form is client-gated via useFormValidity — same as the units form). There's
    // no submit, so no server "WhatsApp inválido" message; assert the gate instead.
    await page.getByRole('textbox', { name: /whatsapp/i }).fill('abc')
    await fillBirthDate(page, '15/04/1990')

    await expect(page.getByRole('button', { name: /continuar/i })).toBeDisabled()
    await expect(page).toHaveURL(/\/onboarding\/profile/)
    const u = await readUser(owner.uid)
    expect(u?.completionCompleted).toBe(false)
  })

  test('data de nascimento menor de 13 anos é rejeitada', async ({ context, page, baseURL }) => {
    const owner = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, owner.email, owner.password, baseURL ?? undefined)

    await page.goto('/onboarding/profile')
    await page.getByRole('textbox', { name: /whatsapp/i }).fill(uniqueNationalWhatsapp())
    // 5 years ago — well under the 13-year cutoff.
    const fiveYearsAgo = new Date()
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
    const isoDate = fiveYearsAgo.toISOString().slice(0, 10)
    await fillBirthDate(page, isoToBrDate(isoDate))
    await page.getByRole('button', { name: /continuar/i }).click()

    await expect(page.getByText(/idade mínima/i)).toBeVisible()
  })

  test(
    'convidado precisa completar perfil antes de aceitar o convite (#827 + #838)',
    { tag: '@critical' },
    async ({ context, page, baseURL }) => {
      const owner = await seedOrg({ unitCount: 0, memberOperationCount: 0 })
      // Explicitly seed the invitee without completion so the gate trips.
      const invitee = await seedAuthUser({ completionCompleted: false })
      const { inviteId, rawToken } = await seedInvite({
        orgId: owner.orgId,
        email: invitee.email,
        role: 'manager',
        invitedBy: owner.uid,
      })
      await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

      await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
      // Gate fires — landed on profile with `next` pointing back at the invite.
      await expect(page).toHaveURL(/\/onboarding\/profile/)
      await expect(page).toHaveURL(/next=/)

      await page.getByRole('textbox', { name: /whatsapp/i }).fill(uniqueNationalWhatsapp())
      await fillBirthDate(page, '22/07/1992')
      await page.getByRole('button', { name: /continuar/i }).click()

      // After completion the user is back on the invite page and can accept.
      await expect(page).toHaveURL(new RegExp(`/invites/${owner.orgId}/${inviteId}`))
      await page.getByRole('button', { name: /aceitar convite/i }).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })
    },
  )
})
