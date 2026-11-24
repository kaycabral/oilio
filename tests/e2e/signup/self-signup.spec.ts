import { expect, test } from '../fixtures'
import { fillBirthDate } from '../helpers/forms'
import {
  pgListByOrg,
  pgQueryProjection,
  seedAuthUser,
  seedOrg,
  signInAndAttachSession,
  uniqueNationalWhatsapp,
} from '../helpers/session'

async function listCustomers(orgId: string): Promise<Array<{ userId?: string }>> {
  const rows = await pgListByOrg('customers', orgId)
  return rows.map((r) => ({
    userId: typeof r.user_id === 'string' ? r.user_id : undefined,
  }))
}

test.describe('Auto-cadastro (#840)', () => {
  test('CTA pública em /{slug} rotea para /signup?from={slug}', async ({ page }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    const slug = `e2e-${seed.orgId}`.toLowerCase()

    await page.goto(`/${slug}`)
    await page.getByRole('link', { name: /cadastrar-se/i }).click()
    await expect(page).toHaveURL(new RegExp(`/signup\\?from=${slug}$`))
    await expect(page.getByRole('heading', { name: /cadastrar-se no oilio/i })).toBeVisible()
    await expect(page.getByText(new RegExp(`encaminhado por.*${seed.orgId}`, 'i'))).toBeVisible()
  })

  test(
    'cadastro completo com origem válida materializa Cliente na empresa',
    { tag: '@critical' },
    async ({ context, page, baseURL }) => {
      const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
      const slug = `e2e-${seed.orgId}`.toLowerCase()

      const customer = await seedAuthUser({ completionCompleted: false })
      await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

      const next = `/${slug}`
      await page.goto(`/onboarding/profile?next=${encodeURIComponent(next)}`)
      await page.getByRole('textbox', { name: /whatsapp/i }).fill(uniqueNationalWhatsapp())
      await fillBirthDate(page, '30/06/1988')
      await page.getByRole('button', { name: /continuar/i }).click()

      await expect(page).toHaveURL(new RegExp(`/${slug}(/|$)`), { timeout: 10_000 })

      const customers = await listCustomers(seed.orgId)
      expect(customers).toHaveLength(1)
      expect(customers[0]!.userId).toBe(customer.uid)

      const userRows = await pgQueryProjection('users', 'uid', customer.uid)
      expect(userRows).toHaveLength(1)
      expect(userRows[0]!.completion_completed).toBe(true)
    },
  )

  test('sem origem, funciona como cadastro de plataforma puro (sem Cliente)', async ({
    context,
    page,
    baseURL,
  }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })

    const customer = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

    await page.goto(`/onboarding/profile?next=${encodeURIComponent('/signup/done')}`)
    await page.getByRole('textbox', { name: /whatsapp/i }).fill(uniqueNationalWhatsapp())
    await fillBirthDate(page, '20/02/1985')
    await page.getByRole('button', { name: /continuar/i }).click()

    await expect(page).toHaveURL(/\/signup\/done$/, { timeout: 10_000 })
    await expect(page.getByText(/sua conta no oilio foi criada/i)).toBeVisible()

    const customers = await listCustomers(seed.orgId)
    expect(customers).toHaveLength(0)
  })

  test('cadastro com origem inválida cai em cadastro de plataforma (fallback silencioso)', async ({
    context,
    page,
    baseURL,
  }) => {
    const customer = await seedAuthUser({ completionCompleted: true })
    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

    await page.goto('/signup/done?from=slug-que-nao-existe-12345')
    await expect(page).toHaveURL(/\/signup\/done\?from=/)
    await expect(page.getByText(/sua conta no oilio foi criada/i)).toBeVisible()
  })

  test('done sem sessão redireciona pra /signup preservando a origem', async ({ page }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    const slug = `e2e-${seed.orgId}`.toLowerCase()

    await page.goto(`/signup/done?from=${slug}`)
    await expect(page).toHaveURL(new RegExp(`/signup\\?from=${slug}$`))
  })

  test('visitante retornando em /done re-usa o mesmo Cliente (idempotente)', async ({
    context,
    page,
    baseURL,
  }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    const slug = `e2e-${seed.orgId}`.toLowerCase()

    const customer = await seedAuthUser({ completionCompleted: true })
    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

    await page.goto(`/signup/done?from=${slug}`)
    await expect(page).toHaveURL(new RegExp(`/signup/done\\?from=${slug}$`))
    await page.goto(`/signup/done?from=${slug}`)
    await expect(page).toHaveURL(new RegExp(`/signup/done\\?from=${slug}$`))

    const customers = await listCustomers(seed.orgId)
    expect(customers.filter((c) => c.userId === customer.uid)).toHaveLength(1)
  })
})
