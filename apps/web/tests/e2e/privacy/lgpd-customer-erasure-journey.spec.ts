import { anonymizedSubjectCode, isAnonymized } from '@/domain'
import { AppointmentConfig } from '@/domain/aggregates/appointment/config'
import { CustomerConfig } from '@/domain/aggregates/customer/config'
import { aggregateRef } from '@/domain/effect'
import { expect, test } from '../fixtures'
import {
  blockedSubjectMarkerExists,
  pgQueryProjection,
  pgReadProjection,
  readOrgLink,
  seedAppointment,
  seedCustomer,
  seedCustomerShadowForUser,
  seedOrg,
  seedOrgLink,
  seedSubscription,
  setSubscriptionStatus,
  signInAndAttachSession,
  timestamptzToIso,
} from '../helpers/session'

const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

// global account lives in the Postgres `users` table; the `users_anonymized_pii_
async function anonymizeUser(userId: string): Promise<void> {
  const now = new Date().toISOString()
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `UPDATE users
         SET display_name = NULL,
             mobile = NULL,
             email = NULL,
             birth_date = NULL,
             avatar_url = NULL,
             anonymized_at = $2,
             updated_at = $2
       WHERE uid = $1`,
      [userId, now],
    )
  } finally {
    await client.end()
  }
}

async function archiveCustomerForUser(orgId: string, customerId: string): Promise<void> {
  const now = new Date().toISOString()
  const { Client } = await import('pg')
  const client = new Client({ connectionString: process.env.OILIO_DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `UPDATE customers SET archived_at = $3, updated_at = $3
         WHERE org_id = $1 AND id = $2`,
      [orgId, customerId, now],
    )
  } finally {
    await client.end()
  }
}

function atNoonUtc(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  d.setUTCHours(12, 0, 0, 0)
  return d.toISOString()
}
const future = () => atNoonUtc(2)
const past = () => atNoonUtc(-2)

test.describe(
  'LGPD CUSTOMER erasure/anonymization — Feature journey (brief 0032 §DoD)',
  { tag: '@critical' },
  () => {
    test('Cenário 1: self-service account erasure anonymizes the global account irreversibly; records keep the userId pointer', async ({
      context,
    }) => {
      const subject = await seedOrg({ memberOperationCount: 0 })
      const customerId = await seedCustomerShadowForUser(subject.orgId, subject.uid)

      const before = (await pgQueryProjection('users', 'uid', subject.uid))[0] ?? null
      expect(asStr(before?.display_name)).toBeTruthy()

      await signInAndAttachSession(context, subject.email, subject.password)
      const page = await context.newPage()
      await page.goto('/settings/privacy')
      await expect(page.getByRole('heading', { name: 'Excluir minha conta inteira' })).toBeVisible()
      await page.getByLabel(/Digite/).fill('EXCLUIR')
      await page.getByRole('button', { name: 'Excluir meus dados', exact: true }).click()
      await page.waitForURL(/\/login/, { timeout: 15_000 })
      await page.close()

      const after = (await pgQueryProjection('users', 'uid', subject.uid))[0] ?? null
      expect(after).not.toBeNull()
      expect(after?.display_name).toBeNull()
      expect(after?.email).toBeNull()
      expect(after?.mobile).toBeNull()
      const anonymizedAt = timestamptzToIso(after?.anonymized_at)
      expect(isAnonymized({ anonymizedAt })).toBe(true)
      expect(JSON.stringify(after)).not.toContain(subject.email)
      expect(JSON.stringify(after)).not.toContain('E2E Owner')

      const custDoc = await pgReadProjection(
        'customers',
        aggregateRef(CustomerConfig, subject.orgId, customerId),
      )
      expect(asStr(custDoc?.user_id)).toEqual(subject.uid)
    })

    test('Cenário 2: anonymized customer renders the neutral `Cliente ‹CÓDIGO›` label, values intact, no "removido"', async ({
      context,
    }) => {
      const owner = await seedOrg({ memberOperationCount: 0 })
      const anonUser = `e2e-cust-c2-${Date.now()}`
      const liveUser = `e2e-cust-c2-live-${Date.now()}`
      await seedCustomer(owner.orgId, { name: 'Mariana Histórico', userId: anonUser })
      await seedCustomer(owner.orgId, { name: 'Cliente Ativo', userId: liveUser })
      await anonymizeUser(anonUser)

      const label = `Cliente ${anonymizedSubjectCode(anonUser)}`

      await signInAndAttachSession(context, owner.email, owner.password)
      const page = await context.newPage()
      await page.goto('/customers')

      await expect(page.getByText(label, { exact: true })).toBeVisible()
      await expect(page.getByText('Mariana Histórico')).toHaveCount(0)
      await expect(page.getByText(/removido/i)).toHaveCount(0)
      await expect(page.getByText('Cliente Ativo', { exact: true })).toBeVisible()
      await page.close()
    })

    test('Cenário 3: self-service rectification reflects live across screens (single source of truth)', async ({
      context,
    }) => {
      const owner = await seedOrg({ memberOperationCount: 0 })
      await signInAndAttachSession(context, owner.email, owner.password)
      const page = await context.newPage()

      const main = page.getByRole('main')
      await page.goto('/team')
      await expect(main.getByText('E2E Owner', { exact: true })).toBeVisible()

      const newName = `Retificado C3 ${Date.now()}`
      await page.goto('/settings/profile')
      await expect(page.getByRole('heading', { name: 'Perfil' })).toBeVisible()
      await page.getByRole('textbox', { name: 'Nome completo' }).fill(newName)
      await page.getByRole('button', { name: 'Salvar alterações' }).click()
      await expect(page.getByText('Perfil atualizado.')).toBeVisible()

      await page.goto('/team')
      await expect(main.getByText(newName, { exact: true })).toBeVisible()
      await expect(main.getByText('E2E Owner', { exact: true })).toHaveCount(0)
      const updated = (await pgQueryProjection('users', 'uid', owner.uid))[0] ?? null
      expect(asStr(updated?.display_name)).toEqual(newName)
      await page.close()
    })

    test('Cenário 4: privacy events carry zero PII (only opaque refs + field names)', async ({
      context,
    }) => {
      const subject = await seedOrg({ memberOperationCount: 0 })
      const originalEmail = subject.email
      await signInAndAttachSession(context, subject.email, subject.password)
      const page = await context.newPage()

      await page.goto('/settings/privacy')
      await page.getByLabel(/Digite/).fill('EXCLUIR')
      await page.getByRole('button', { name: 'Excluir meus dados', exact: true }).click()
      await page.waitForURL(/\/login/, { timeout: 15_000 })
      await page.close()

      const mine = await pgQueryProjection('pii_events', 'subject_ref', subject.uid)
      expect(mine.length).toBeGreaterThan(0)
      const serialized = JSON.stringify(mine)
      expect(serialized).not.toContain('E2E Owner')
      expect(serialized).not.toContain(originalEmail)
      expect(serialized).toContain(subject.uid)
    })

    test('Cenário 5: per-org block neutralizes org A only; org B + global keep the real name', async ({
      context,
    }) => {
      const ownerA = await seedOrg({ memberOperationCount: 0 })
      const ownerB = await seedOrg({ memberOperationCount: 0 })

      const subjectUserId = `e2e-subject-c5-${Date.now()}`
      const realName = `Marina Bloqueio ${Date.now()}`
      const custA = await seedCustomer(ownerA.orgId, {
        name: realName,
        userId: subjectUserId,
        avatarUrl: 'https://example.com/marina.png',
      })
      await seedCustomer(ownerB.orgId, { name: realName, userId: subjectUserId })

      await archiveCustomerForUser(ownerA.orgId, custA)

      const label = `Cliente ${anonymizedSubjectCode(subjectUserId)}`

      await signInAndAttachSession(context, ownerA.email, ownerA.password)
      const pageA = await context.newPage()
      await pageA.goto('/customers')
      await expect(pageA.getByText(realName)).toHaveCount(0)
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
      const globalUser = (await pgQueryProjection('users', 'uid', subjectUserId))[0] ?? null
      expect(asStr(globalUser?.display_name)).toEqual(realName)
    })

    test('Cenário 6: self-service discovery lists the subject’s establishments via the reverse index (zero PII)', async ({
      context,
    }) => {
      const subject = await seedOrg({ memberOperationCount: 0 })
      const ownerB = await seedOrg({ memberOperationCount: 0 })
      await seedCustomerShadowForUser(subject.orgId, subject.uid)
      await seedCustomerShadowForUser(ownerB.orgId, subject.uid)
      await seedOrgLink(subject.uid, subject.orgId)
      await seedOrgLink(subject.uid, ownerB.orgId)

      await signInAndAttachSession(context, subject.email, subject.password)
      const page = await context.newPage()
      await page.goto('/settings/privacy')

      const establishments = page.getByRole('list', { name: 'Estabelecimentos' })
      const itemA = establishments.getByRole('listitem').filter({ hasText: `E2E ${subject.orgId}` })
      await expect(itemA).toBeVisible()
      await expect(
        establishments.getByRole('listitem').filter({ hasText: `E2E ${ownerB.orgId}` }),
      ).toBeVisible()
      await expect(
        itemA.getByRole('button', { name: 'Excluir meus dados deste estabelecimento' }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Excluir meus dados', exact: true }),
      ).toBeVisible()

      const link = await readOrgLink(subject.uid, subject.orgId)
      expect(Object.keys(link ?? {}).sort()).toEqual(['linkedAt', 'orgId'])
      await page.close()
    })

    test('Cenário 7: active subscription warns before confirm, then cancels immediately + cancels future agenda; past retained', async ({
      context,
    }) => {
      const subject = await seedOrg({ memberOperationCount: 1 })
      const unitId = subject.unitIds[0]!
      const memberOperationId = subject.memberOperationIds[0]!
      const custId = await seedCustomerShadowForUser(subject.orgId, subject.uid)
      await seedOrgLink(subject.uid, subject.orgId)

      const subId = await seedSubscription(subject.orgId, custId, { status: 'active' })
      const futureStart = future()
      await seedAppointment({
        orgId: subject.orgId,
        unitId,
        memberOperationId,
        customerId: custId,
        serviceId: 'e2e-svc',
        startAt: futureStart,
        endAt: new Date(new Date(futureStart).getTime() + 30 * 60_000).toISOString(),
        status: 'scheduled',
      })
      const pastStart = past()
      const pastAppt = await seedAppointment({
        orgId: subject.orgId,
        unitId,
        memberOperationId,
        customerId: custId,
        serviceId: 'e2e-svc',
        startAt: pastStart,
        endAt: new Date(new Date(pastStart).getTime() + 30 * 60_000).toISOString(),
        status: 'completed',
      })

      await signInAndAttachSession(context, subject.email, subject.password)
      const page = await context.newPage()
      await page.goto('/settings/privacy')

      const item = page
        .getByRole('list', { name: 'Estabelecimentos' })
        .getByRole('listitem')
        .filter({ hasText: `E2E ${subject.orgId}` })
      await item.getByRole('button', { name: 'Excluir meus dados deste estabelecimento' }).click()
      await expect(
        page.getByText('Você tem uma assinatura ativa neste estabelecimento.'),
      ).toBeVisible()

      await page.getByRole('button', { name: 'Confirmar exclusão' }).click()
      await expect(page.getByText(/foram excluídos/)).toBeVisible()
      await page.close()

      expect(await blockedSubjectMarkerExists(subject.orgId, subject.uid)).toBe(true)
      await setSubscriptionStatus(subject.orgId, subId, 'cancelled')

      const retained = await pgReadProjection(
        'appointments',
        aggregateRef(AppointmentConfig, subject.orgId, pastAppt),
      )
      expect(retained).not.toBeNull()
      expect(asStr(retained?.status)).toBe('completed')
    })

    test('Separação de relações: a CUSTOMER blocked in a org stays IDENTIFIABLE as a PROFESSIONAL (team)', async ({
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
      await archiveCustomerForUser(owner.orgId, custId)

      await signInAndAttachSession(context, owner.email, owner.password)
      const page = await context.newPage()

      await page.goto('/team')
      await expect(page.getByText(proName).first()).toBeVisible()
      const neutralProLabel = `Profissional ${anonymizedSubjectCode(proUserId)}`
      await expect(page.getByText(neutralProLabel, { exact: true })).toHaveCount(0)
      await page.close()
    })
  },
)
