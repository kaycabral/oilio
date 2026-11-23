import { expect, test } from '../fixtures'
import {
  seedAuthUser,
  seedCustomerShadowForUser,
  seedOrg,
  signInAndAttachSession,
} from '../helpers/session'

test.describe('Roteamento pós-login por persona (#1434)', { tag: '@critical' }, () => {
  test('cliente (org link, sem membership) na landing vai para /me/appointments', async ({
    context,
    page,
    baseURL,
  }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    const client = await seedAuthUser({ completionCompleted: true })
    await seedCustomerShadowForUser(seed.orgId, client.uid)
    await signInAndAttachSession(context, client.email, client.password, baseURL ?? undefined)

    await page.goto('/')
    await expect(page).toHaveURL(/\/me\/appointments$/)
  })

  test('cliente na /pricing não é jogado para /dashboard', async ({ context, page, baseURL }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    const client = await seedAuthUser({ completionCompleted: true })
    await seedCustomerShadowForUser(seed.orgId, client.uid)
    await signInAndAttachSession(context, client.email, client.password, baseURL ?? undefined)

    await page.goto('/pricing')
    await expect(page).toHaveURL(/\/me\/appointments$/)
  })

  test('/me exige vínculo: sessão sem org link é redirecionada para fora', async ({
    context,
    page,
    baseURL,
  }) => {
    const unlinked = await seedAuthUser({ completionCompleted: true })
    await signInAndAttachSession(context, unlinked.email, unlinked.password, baseURL ?? undefined)

    await page.goto('/me/appointments')
    await expect(page).not.toHaveURL(/\/me\//)
  })

  test('cliente vinculado acessa /me/appointments', async ({ context, page, baseURL }) => {
    const seed = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    const client = await seedAuthUser({ completionCompleted: true })
    await seedCustomerShadowForUser(seed.orgId, client.uid)
    await signInAndAttachSession(context, client.email, client.password, baseURL ?? undefined)

    await page.goto('/me/appointments')
    await expect(page).toHaveURL(/\/me\/appointments$/)
  })
})
