import { isAnonymized } from '@/domain'
import { expect, test } from '../fixtures'
import {
  blockedSubjectMarkerExists,
  readOrgLink,
  readUser,
  seedCustomerShadowForUser,
  seedOrg,
  seedOrgLink,
  seedSubscription,
  signInAndAttachSession,
} from '../helpers/session'

test.describe('CUSTOMER self-service discovery + erasure', () => {
  test('baseline: privacy surface renders; subject with no links sees the empty state', async ({
    context,
  }) => {
    const owner = await seedOrg({ memberOperationCount: 0 })
    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    await page.goto('/settings/privacy')
    await expect(page.getByRole('heading', { name: 'Privacidade' })).toBeVisible()
    await expect(
      page.getByText('Você não é cliente de nenhum estabelecimento no momento.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Excluir meus dados' })).toBeVisible()
    await page.close()
  })

  test('subject in 2 orgs sees both; erasing one blocks only that org; index holds zero PII', async ({
    context,
  }) => {
    const subject = await seedOrg({ memberOperationCount: 0 })
    const ownerB = await seedOrg({ memberOperationCount: 0 })

    const custA = await seedCustomerShadowForUser(subject.orgId, subject.uid)
    await seedCustomerShadowForUser(ownerB.orgId, subject.uid)
    await seedOrgLink(subject.uid, subject.orgId)
    await seedOrgLink(subject.uid, ownerB.orgId)

    await seedSubscription(subject.orgId, custA, { status: 'active' })

    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await page.goto('/settings/privacy')

    const establishments = page.getByRole('list', { name: 'Estabelecimentos' })
    const itemA = establishments.getByRole('listitem').filter({ hasText: `E2E ${subject.orgId}` })
    const itemB = establishments.getByRole('listitem').filter({ hasText: `E2E ${ownerB.orgId}` })
    await expect(itemA).toBeVisible()
    await expect(itemB).toBeVisible()

    const link = await readOrgLink(subject.uid, subject.orgId)
    expect(link).not.toBeNull()
    expect(Object.keys(link ?? {}).sort()).toEqual(['linkedAt', 'orgId'])

    expect(await readOrgLink(ownerB.uid, ownerB.orgId)).toBeNull()

    await itemA.getByRole('button', { name: 'Excluir meus dados deste estabelecimento' }).click()
    await expect(
      page.getByText('Você tem uma assinatura ativa neste estabelecimento.'),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Confirmar exclusão' }).click()
    await expect(page.getByText(/foram excluídos/)).toBeVisible()

    expect(await blockedSubjectMarkerExists(subject.orgId, subject.uid)).toBe(true)
    expect(await blockedSubjectMarkerExists(ownerB.orgId, subject.uid)).toBe(false)

    await page.close()
  })

  test('erasing the whole account anonymizes the global doc + cancels the active subscription, with the warning shown', async ({
    context,
  }) => {
    const subject = await seedOrg({ memberOperationCount: 0 })
    const custId = await seedCustomerShadowForUser(subject.orgId, subject.uid)
    await seedOrgLink(subject.uid, subject.orgId)
    await seedSubscription(subject.orgId, custId, { status: 'active' })

    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await page.goto('/settings/privacy')

    await expect(page.getByRole('heading', { name: 'Excluir minha conta inteira' })).toBeVisible()

    await page.getByLabel(/Digite/).fill('EXCLUIR')
    await page.getByRole('button', { name: 'Excluir meus dados', exact: true }).click()

    await page.waitForURL(/\/login/, { timeout: 15000 })
    await page.close()

    const user = await readUser(subject.uid)
    expect(user).not.toBeNull()
    expect(isAnonymized({ anonymizedAt: user?.anonymizedAt ?? null })).toBe(true)
  })
})
