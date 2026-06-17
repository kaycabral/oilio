import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { parseJson } from '../helpers/firestore-rest'
import { fillBirthDate } from '../helpers/forms'
import { readUser, seedAuthUser, seedTenant, signInAndAttachSession } from '../helpers/session'

// #840 + refator pós-revisão. Signup virou plataforma-canônico em
// `/signup?from={slug}`: o cadastro é evento do Oilio (User global);
// o tenant é atribuição de intenção via query, não boundary de cadastro.
//
// O OAuth popup é impraticável de exercitar no Playwright, então o
// shortcut padrão dos outros specs auth-bound é usado: `seedAuthUser` +
// `signInAndAttachSession` produzem uma sessão equivalente à que o
// Firebase OAuth mintaria, e a partir daí dirigimos a partir de
// `/onboarding/profile` — o mesmo path que o botão OAuth navegaria via
// seu `next`.

function fsBaseUrl() {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

function curlJson<T>(args: string[], decode: (u: unknown) => T): T {
  const out = execFileSync('curl', ['-fsS', ...args], { encoding: 'utf8' })
  return parseJson(out, decode)
}

const decodeCustomersList = Schema.decodeUnknownSync(
  Schema.Struct({
    documents: Schema.optional(
      Schema.Array(
        Schema.Struct({
          fields: Schema.optional(
            Schema.Struct({
              userId: Schema.optional(
                Schema.Struct({ stringValue: Schema.optional(Schema.String) }),
              ),
            }),
          ),
        }),
      ),
    ),
  }),
)

function listCustomers(tenantId: string): Array<{ userId?: string }> {
  try {
    const json = curlJson(
      [`${fsBaseUrl()}/tenants/${tenantId}/customers`, '-H', 'Authorization: Bearer owner'],
      decodeCustomersList,
    )
    return (json.documents ?? []).map((d) => ({
      userId: d.fields?.userId?.stringValue,
    }))
  } catch {
    return []
  }
}

test.describe('Auto-cadastro (#840)', () => {
  test('CTA pública em /{slug} rotea para /signup?from={slug}', async ({ page }) => {
    const seed = await seedTenant({ unitCount: 1, professionalCount: 1 })
    const slug = `e2e-${seed.tenantId}`.toLowerCase()

    await page.goto(`/${slug}`)
    await page.getByRole('link', { name: /cadastrar-se/i }).click()
    await expect(page).toHaveURL(new RegExp(`/signup\\?from=${slug}$`))
    await expect(page.getByRole('heading', { name: /cadastrar-se no scheduling/i })).toBeVisible()
    await expect(page.getByText(new RegExp(`encaminhado por.*${seed.tenantId}`, 'i'))).toBeVisible()
  })

  test(
    'cadastro completo com origem válida materializa Cliente na empresa',
    { tag: '@critical' },
    async ({ context, page, baseURL }) => {
      const seed = await seedTenant({ unitCount: 1, professionalCount: 1 })
      const slug = `e2e-${seed.tenantId}`.toLowerCase()

      const customer = await seedAuthUser({ completionCompleted: false })
      await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

      // O botão OAuth na /signup?from=... navegaria pra /signup/done?from=...,
      // e o gate do done bounceria pra /onboarding/profile com next preservando
      // o from. Vamos direto pro completion espelhando esse next.
      const next = `/signup/done?from=${slug}`
      await page.goto(`/onboarding/profile?next=${encodeURIComponent(next)}`)
      await page.getByRole('textbox', { name: /nome/i }).fill('Cliente Smoke')
      await page.getByRole('textbox', { name: /whatsapp/i }).fill('11977776666')
      await fillBirthDate(page, '30/06/1988')
      await page.getByRole('button', { name: /continuar/i }).click()

      await expect(page).toHaveURL(new RegExp(`/signup/done\\?from=${slug}$`), { timeout: 10_000 })
      await expect(page.getByRole('heading', { name: /pronto/i })).toBeVisible()
      await expect(page.getByText(new RegExp(`cadastrado em.*${seed.tenantId}`, 'i'))).toBeVisible()

      const customers = listCustomers(seed.tenantId)
      expect(customers).toHaveLength(1)
      expect(customers[0]!.userId).toBe(customer.uid)

      const u = readUser(customer.uid) as {
        completionCompleted?: { booleanValue?: boolean }
      } | null
      expect(u?.completionCompleted?.booleanValue).toBe(true)
    },
  )

  test('sem origem, funciona como cadastro de plataforma puro (sem Cliente)', async ({
    context,
    page,
    baseURL,
  }) => {
    // Tenant existe pra cenário ser realista, mas o signup não atribui a ele.
    const seed = await seedTenant({ unitCount: 1, professionalCount: 1 })

    const customer = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

    await page.goto(`/onboarding/profile?next=${encodeURIComponent('/signup/done')}`)
    await page.getByRole('textbox', { name: /nome/i }).fill('Sem Tenant')
    await page.getByRole('textbox', { name: /whatsapp/i }).fill('11955554444')
    await fillBirthDate(page, '20/02/1985')
    await page.getByRole('button', { name: /continuar/i }).click()

    await expect(page).toHaveURL(/\/signup\/done$/, { timeout: 10_000 })
    await expect(page.getByText(/sua conta no scheduling foi criada/i)).toBeVisible()

    // Nenhum Customer materializado no tenant — usuário só existe como User global.
    const customers = listCustomers(seed.tenantId)
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
    await expect(page.getByText(/sua conta no scheduling foi criada/i)).toBeVisible()
  })

  test('done sem sessão redireciona pra /signup preservando a origem', async ({ page }) => {
    const seed = await seedTenant({ unitCount: 1, professionalCount: 1 })
    const slug = `e2e-${seed.tenantId}`.toLowerCase()

    await page.goto(`/signup/done?from=${slug}`)
    await expect(page).toHaveURL(new RegExp(`/signup\\?from=${slug}$`))
  })

  test('visitante retornando em /done re-usa o mesmo Cliente (idempotente)', async ({
    context,
    page,
    baseURL,
  }) => {
    const seed = await seedTenant({ unitCount: 1, professionalCount: 1 })
    const slug = `e2e-${seed.tenantId}`.toLowerCase()

    const customer = await seedAuthUser({ completionCompleted: true })
    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

    await page.goto(`/signup/done?from=${slug}`)
    await expect(page).toHaveURL(new RegExp(`/signup/done\\?from=${slug}$`))
    await page.goto(`/signup/done?from=${slug}`)
    await expect(page).toHaveURL(new RegExp(`/signup/done\\?from=${slug}$`))

    const customers = listCustomers(seed.tenantId)
    expect(customers.filter((c) => c.userId === customer.uid)).toHaveLength(1)
  })
})
