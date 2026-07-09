import { anonymizedSubjectCode, buildUserAnonymizationScrub } from '@/domain'
import type { UserAnonymized } from '@/domain/types/user'
import { getUserById, putUser } from '@/shared/db/pg/users-store'
import { expect, test } from '../fixtures'
import { seedCustomer, seedMember, seedOrg, signInAndAttachSession } from '../helpers/session'

async function anonymizeUser(userId: string): Promise<void> {
  const user = await getUserById(userId)
  if (user === null) {
    throw new Error(`anonymizeUser: user ${userId} not found`)
  }
  const now = new Date().toISOString()
  const scrub = buildUserAnonymizationScrub(now)
  const anonymized: UserAnonymized = {
    uid: user.uid,
    emailVerified: user.emailVerified,
    currentOrgId: user.currentOrgId,
    claimedAt: user.claimedAt,
    termsAcceptedAt: user.termsAcceptedAt,
    termsVersion: user.termsVersion,
    privacyAcceptedAt: user.privacyAcceptedAt,
    privacyVersion: user.privacyVersion,
    createdAt: user.createdAt,
    completionCompleted: user.completionCompleted,
    email: scrub.email,
    displayName: scrub.displayName,
    avatarUrl: scrub.avatarUrl,
    taxIdentity: scrub.taxIdentity,
    bio: scrub.bio,
    specialties: scrub.specialties,
    mobile: null,
    birthDate: null,
    anonymizedAt: now,
    updatedAt: now,
  }
  await putUser(anonymized)
}

test.describe('neutral label for anonymized accounts', () => {
  test('customer list: anonymized accounts show `Cliente ‹CODE›`, two stay distinct, a live account keeps its name', async ({
    context,
  }) => {
    const owner = await seedOrg({ memberOperationCount: 0 })

    const anonUserA = `e2e-cust-anon-a-${Date.now()}`
    const anonUserB = `e2e-cust-anon-b-${Date.now()}`
    const liveUser = `e2e-cust-live-${Date.now()}`
    await seedCustomer(owner.orgId, { name: 'Ana Anonimizada', userId: anonUserA })
    await seedCustomer(owner.orgId, { name: 'Bruno Anonimizado', userId: anonUserB })
    await seedCustomer(owner.orgId, { name: 'Carla Ativa', userId: liveUser })

    await anonymizeUser(anonUserA)
    await anonymizeUser(anonUserB)

    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()
    await page.goto('/customers')

    const labelA = `Cliente ${anonymizedSubjectCode(anonUserA)}`
    const labelB = `Cliente ${anonymizedSubjectCode(anonUserB)}`

    await expect(page.getByText(labelA, { exact: true })).toBeVisible()
    await expect(page.getByText(labelB, { exact: true })).toBeVisible()
    expect(labelA).not.toEqual(labelB)
    await expect(page.getByText('Ana Anonimizada')).toHaveCount(0)
    await expect(page.getByText('Bruno Anonimizado')).toHaveCount(0)
    await expect(page.getByText(/removido/i)).toHaveCount(0)
    await expect(page.getByText('Carla Ativa', { exact: true })).toBeVisible()
  })

  test('team list + member detail: anonymized member shows `Profissional ‹CODE›`', async ({
    context,
  }) => {
    const owner = await seedOrg({ memberOperationCount: 0 })
    const { userId } = await seedMember(owner.orgId, {
      role: 'member_operator',
      displayName: 'Daniel Profissional',
    })
    await anonymizeUser(userId)

    const label = `Profissional ${anonymizedSubjectCode(userId)}`

    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    await page.goto('/team')
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Daniel Profissional')).toHaveCount(0)
    await expect(page.getByText(/removido/i)).toHaveCount(0)

    await page.goto(`/team/${userId}`)
    await expect(page.getByRole('heading', { name: label })).toBeVisible()
    await expect(page.getByText('Daniel Profissional')).toHaveCount(0)
  })
})
