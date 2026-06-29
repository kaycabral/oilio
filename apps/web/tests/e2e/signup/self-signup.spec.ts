import { expect, test } from '../fixtures'
import { fillBirthDate } from '../helpers/forms'
import {
  pgListByOrg,
  pgQueryProjection,
  seedAuthUser,
  seedOrg,
  signInAndAttachSession,
} from '../helpers/session'

// #840 + refator pós-revisão. Signup virou plataforma-canônico em
// `/signup?from={slug}`: o cadastro é evento do Oilio (User global);
// o org é atribuição de intenção via query, não boundary de cadastro.
//
// O OAuth popup é impraticável de exercitar no Playwright, então o
// shortcut padrão dos outros specs auth-bound é usado: `seedAuthUser` +
// `signInAndAttachSession` produzem uma sessão equivalente à que o
// Firebase OAuth mintaria, e a partir daí dirigimos a partir de
// `/onboarding/profile` — o mesmo path que o botão OAuth navegaria via
// seu `next`.

// Lê os Customers materializados num org direto da projeção Postgres
// (`customers`, snake_case). Cada linha carrega o FK `user_id` pro User global.
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

      // O botão OAuth na /signup?from=... navegaria pra /signup/done?from=...,
      // e o gate do done bounceria pra /onboarding/profile com next preservando
      // o from. Vamos direto pro completion espelhando esse next.
      const next = `/signup/done?from=${slug}`
      await page.goto(`/onboarding/profile?next=${encodeURIComponent(next)}`)
      // Identity supplied the name (seedAuthUser displayName) — confirmed, not asked.
      await page.getByRole('textbox', { name: /whatsapp/i }).fill('11977776666')
      await fillBirthDate(page, '30/06/1988')
      await page.getByRole('button', { name: /continuar/i }).click()

      await expect(page).toHaveURL(new RegExp(`/signup/done\\?from=${slug}$`), { timeout: 10_000 })
      await expect(page.getByRole('heading', { name: /pronto/i })).toBeVisible()
      await expect(page.getByText(new RegExp(`cadastrado em.*${seed.orgId}`, 'i'))).toBeVisible()

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
    // Org existe pra cenário ser realista, mas o signup não atribui a ele.
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })

    const customer = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

    await page.goto(`/onboarding/profile?next=${encodeURIComponent('/signup/done')}`)
    // Identity supplied the name (seedAuthUser displayName) — confirmed, not asked.
    await page.getByRole('textbox', { name: /whatsapp/i }).fill('11955554444')
    await fillBirthDate(page, '20/02/1985')
    await page.getByRole('button', { name: /continuar/i }).click()

    await expect(page).toHaveURL(/\/signup\/done$/, { timeout: 10_000 })
    await expect(page.getByText(/sua conta no oilio foi criada/i)).toBeVisible()

    // Nenhum Customer materializado no org — usuário só existe como User global.
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

    // Slug que não existe — bundle fica null, /signup/done ignora o from e
    // mostra o cadastro de plataforma puro. Não 404 (signup canônico vale
    // independente de from).
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
