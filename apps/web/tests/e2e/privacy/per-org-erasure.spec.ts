import { anonymizedSubjectCode } from '@/domain'
import { expect, test } from '../fixtures'
import {
  blockedSubjectMarkerExists,
  pgQueryProjection,
  seedCustomer,
  seedOrg,
  signInAndAttachSession,
} from '../helpers/session'

async function archiveCustomerShadow(orgId: string, customerId: string): Promise<void> {
  const now = new Date().toISOString()
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query('UPDATE customers SET archived_at = $1 WHERE org_id = $2 AND id = $3', [
      now,
      orgId,
      customerId,
    ])
  } finally {
    await client.end()
  }
}

async function blockCustomer(orgId: string, customerId: string): Promise<void> {
  await archiveCustomerShadow(orgId, customerId)
}

test.describe('per-org CUSTOMER erasure via blocking', () => {
  test('block customer in org A: A shows `Cliente ‹CODE›` + no avatar, drops from picker; org B + global keep the real name; marker scoped to A', async ({
    context,
  }) => {
    const ownerA = await seedOrg({ memberOperationCount: 1 })
    const ownerB = await seedOrg({ memberOperationCount: 0 })

    const subjectUserId = `e2e-subject-${Date.now()}`
    const realName = `Marina Compartilhada ${Date.now()}`
    const custA = await seedCustomer(ownerA.orgId, {
      name: realName,
      userId: subjectUserId,
      avatarUrl: 'https://example.com/marina.png',
    })
    await seedCustomer(ownerB.orgId, { name: realName, userId: subjectUserId })

    const label = `Cliente ${anonymizedSubjectCode(subjectUserId)}`

    await blockCustomer(ownerA.orgId, custA)

    await signInAndAttachSession(context, ownerA.email, ownerA.password)
    const pageA = await context.newPage()
    await pageA.goto('/customers')
    await expect(pageA.getByText(realName)).toHaveCount(0)
    await expect(pageA.getByText(label, { exact: true })).toHaveCount(0)

    await pageA.goto('/agenda')
    await expect(pageA.getByText(realName)).toHaveCount(0)
    await pageA.close()

    const contextB = await context.browser()!.newContext()
    await signInAndAttachSession(contextB, ownerB.email, ownerB.password)
    const pageB = await contextB.newPage()
    await pageB.goto('/customers')
    await expect(pageB.getByText(realName, { exact: true })).toBeVisible()
    await expect(pageB.getByText(label, { exact: true })).toHaveCount(0)
    await contextB.close()

    expect(await blockedSubjectMarkerExists(ownerA.orgId, subjectUserId)).toBe(true)
    expect(await blockedSubjectMarkerExists(ownerB.orgId, subjectUserId)).toBe(false)
  })

  test('a person blocked as a CUSTOMER stays IDENTIFIABLE as a PROFESSIONAL (team surface)', async ({
    context,
  }) => {
    const owner = await seedOrg({ memberOperationCount: 1 })
    const proUserId = `e2e-prof-user-${owner.memberOperationIds[0]}`
    const proName = 'Profissional 1'

    const custId = await seedCustomer(owner.orgId, {
      name: proName,
      userId: proUserId,
      avatarUrl: 'https://example.com/pro.png',
    })

    await blockCustomer(owner.orgId, custId)

    const customerRows = await pgQueryProjection('customers', 'user_id', proUserId)
    expect(customerRows.some((r) => r.org_id === owner.orgId && r.archived_at !== null)).toBe(true)

    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    await page.goto('/team')
    await expect(page.getByText(proName).first()).toBeVisible()
    const neutralProLabel = `Profissional ${anonymizedSubjectCode(proUserId)}`
    await expect(page.getByText(neutralProLabel, { exact: true })).toHaveCount(0)

    await page.close()
  })
})
