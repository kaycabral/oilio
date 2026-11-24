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

test.describe('Onboarding — conclusão de perfil', () => {
  test('owner sem perfil completo é mandado pra /onboarding/profile e libera o wizard após salvar', async ({
    context,
    page,
    baseURL,
  }) => {
    const owner = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, owner.email, owner.password, baseURL ?? undefined)

    await page.goto('/onboarding')
    await expect(page).toHaveURL(/\/onboarding\/profile/)
    await expect(page.getByRole('heading', { name: /completar seu cadastro/i })).toBeVisible()

    await expect(page.getByText(/você é/i)).toBeVisible()
    await expect(page.getByRole('textbox', { name: /nome/i })).toHaveCount(0)
    await page.getByRole('textbox', { name: /whatsapp/i }).fill(uniqueNationalWhatsapp())
    await fillBirthDate(page, '15/04/1990')
    await page.getByRole('button', { name: /continuar/i }).click()

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
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    await signInAndAttachSession(context, seed.email, seed.password, baseURL ?? undefined)

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('WhatsApp inválido é rejeitado (gate client-side)', async ({ context, page, baseURL }) => {
    const owner = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, owner.email, owner.password, baseURL ?? undefined)

    await page.goto('/onboarding/profile')
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
      const invitee = await seedAuthUser({ completionCompleted: false })
      const { inviteId, rawToken } = await seedInvite({
        orgId: owner.orgId,
        mobile: '5511990002345',
        role: 'manager',
        invitedBy: owner.uid,
      })
      await signInAndAttachSession(context, invitee.email, invitee.password, baseURL ?? undefined)

      await page.goto(`/invites/${owner.orgId}/${inviteId}?token=${rawToken}`)
      await expect(page).toHaveURL(/\/onboarding\/profile/)
      await expect(page).toHaveURL(/next=/)

      await page.getByRole('textbox', { name: /whatsapp/i }).fill(uniqueNationalWhatsapp())
      await fillBirthDate(page, '22/07/1992')
      await page.getByRole('button', { name: /continuar/i }).click()

      await expect(page).toHaveURL(new RegExp(`/invites/${owner.orgId}/${inviteId}`))
      await page.getByRole('button', { name: /aceitar convite/i }).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 })
    },
  )
})
