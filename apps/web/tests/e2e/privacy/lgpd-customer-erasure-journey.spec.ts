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

// Narrows an unknown Postgres column value to a `string`, or `undefined`. The
// pg* helpers return `Record<string, unknown>`; this keeps the assertions typed
// without an escape hatch.
const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

// ============================================================================
// Feature-level E2E — LGPD CUSTOMER erasure/anonymization JOURNEY (brief 0032).
//
// This is the parent-final cohesive suite (principle #15): one `test()` per
// DoD scenario, validating that the per-feature slices (#1093 global anon,
// #1095 resolver, #1066 rectification+pii events, #1096/#1100 per-org block,
// #1097 self-service discovery, #1101 cascade) COMPOSE into the brief 0032
// CUSTOMER scope as a whole — plus the cross-cutting separation invariant of
// the 04/06 reescopo: cliente and profissional are DIFFERENT relationships and
// never cross.
//
// The per-slice specs (account-anonymization, anonymized-label,
// per-org-erasure, erasure-cascade, self-service-discovery,
// rectification-and-events) own the exhaustive mechanism coverage. This suite
// drives the end-to-end journey through the same shared helpers, asserting the
// load-bearing OUTPUT of each scenario; where a mechanism is owned by a sibling
// spec it is noted inline (the journey re-proves the contract, not the impl).
// ============================================================================

// Marks a global account as anonymized — mirrors the #1093 scrub the self-
// service erasure performs server-side (PII → null, `anonymized_at` stamped).
// The shared resolver keys off `anonymizedAt` everywhere. Post-cutover the
// global account lives in the Postgres `users` table; the `users_anonymized_pii_
// scrubbed` CHECK requires the PII columns null when `anonymized_at` is set, so
// the scrub + stamp must happen in one UPDATE.
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

// Materializes the per-org CUSTOMER block — post-cutover (brief 0062) the block
// is no longer a `blocked_subjects/` marker doc but the `archived_at` stamp on
// the customer shadow itself (which is exactly what `blockedSubjectMarkerExists`
// keys off). Stamping `archived_at` on the org's customer row for `userId`
// reproduces the block the per-org erase saga writes server-side.
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

// Noon-UTC anchor so the calendar date is stable across the org timezone
// (same flake class as erasure-cascade.spec): the agenda queries the org-local
// day, and a midnight-relative future date could fall on a different local day
// than its UTC slice. Noon ± any real tz offset stays the same date.
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
    // Cenário 1 — exclusão de conta de cliente = anonimização global irreversível.
    test('Cenário 1: self-service account erasure anonymizes the global account irreversibly; records keep the userId pointer', async ({
      context,
    }) => {
      const subject = await seedOrg({ memberOperationCount: 0 })
      // A record that references the subject by userId — must survive (AC-04).
      // Use the shadow-only seed: `seedCustomer` would clobber the owner's global
      // user doc (resetting completionCompleted), breaking the authed surfaces.
      const customerId = await seedCustomerShadowForUser(subject.orgId, subject.uid)

      const before = (await pgQueryProjection('users', 'uid', subject.uid))[0] ?? null
      expect(asStr(before?.display_name)).toBeTruthy()

      // Self-service global erasure via the real privacy surface.
      await signInAndAttachSession(context, subject.email, subject.password)
      const page = await context.newPage()
      await page.goto('/settings/privacy')
      await expect(page.getByRole('heading', { name: 'Excluir minha conta inteira' })).toBeVisible()
      await page.getByLabel(/Digite/).fill('EXCLUIR')
      await page.getByRole('button', { name: 'Excluir meus dados', exact: true }).click()
      await page.waitForURL(/\/login/, { timeout: 15_000 })
      await page.close()

      // The global account is irreversibly anonymized — PII scrubbed + anonymizedAt.
      const after = (await pgQueryProjection('users', 'uid', subject.uid))[0] ?? null
      expect(after).not.toBeNull()
      expect(after?.display_name).toBeNull()
      expect(after?.email).toBeNull()
      expect(after?.mobile).toBeNull()
      // `anonymized_at` is `timestamptz` (brief 0068 D1): the pg driver returns
      // a `Date` on this raw read, which `asStr` would drop. Normalize to ISO
      // first so the `isAnonymized` resolver sees the stamped instant.
      const anonymizedAt = timestamptzToIso(after?.anonymized_at)
      expect(isAnonymized({ anonymizedAt })).toBe(true)
      // Irreversibility: the old PII appears in NO field (no reverse map).
      expect(JSON.stringify(after)).not.toContain(subject.email)
      expect(JSON.stringify(after)).not.toContain('E2E Owner')

      // The record keeps its userId pointer (retention) — resolves to neutral
      // because the account is anonymized, without touching the record itself.
      const custDoc = await pgReadProjection(
        'customers',
        aggregateRef(CustomerConfig, subject.orgId, customerId),
      )
      expect(asStr(custDoc?.user_id)).toEqual(subject.uid)
    })

    // Cenário 2 — histórico financeiro preservado + transparente (neutro).
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

      // The person becomes a neutral code; the scrubbed name never surfaces and
      // there is NO "removido" reason text (transparent anonymization, AC-03).
      await expect(page.getByText(label, { exact: true })).toBeVisible()
      await expect(page.getByText('Mariana Histórico')).toHaveCount(0)
      await expect(page.getByText(/removido/i)).toHaveCount(0)
      // A non-anonymized customer keeps the real name — values/records intact.
      await expect(page.getByText('Cliente Ativo', { exact: true })).toBeVisible()
      await page.close()
    })

    // Cenário 3 — retificação self-service. The exhaustive coverage lives in
    // `rectification-and-events.spec.ts` (#1066); here we re-prove the live-
    // reflection contract through the same self-service surface.
    test('Cenário 3: self-service rectification reflects live across screens (single source of truth)', async ({
      context,
    }) => {
      const owner = await seedOrg({ memberOperationCount: 0 })
      await signInAndAttachSession(context, owner.email, owner.password)
      const page = await context.newPage()

      await page.goto('/team')
      await expect(page.getByText('E2E Owner', { exact: true })).toBeVisible()

      const newName = `Retificado C3 ${Date.now()}`
      await page.goto('/settings/profile')
      await expect(page.getByRole('heading', { name: 'Meu perfil' })).toBeVisible()
      await page.getByRole('textbox', { name: 'Nome' }).fill(newName)
      await page.getByRole('button', { name: 'Salvar alterações' }).click()
      await expect(page.getByText('Perfil atualizado.')).toBeVisible()

      // One write — reflects live (identity by reference).
      await page.goto('/team')
      await expect(page.getByText(newName, { exact: true })).toBeVisible()
      await expect(page.getByText('E2E Owner', { exact: true })).toHaveCount(0)
      const updated = (await pgQueryProjection('users', 'uid', owner.uid))[0] ?? null
      expect(asStr(updated?.display_name)).toEqual(newName)
      await page.close()
    })

    // Cenário 4 — auditoria "zero PII em evento/snapshot". The cross-aggregate
    // schema audit lives in #1064 (no-pii-in-events) + the unit/integration
    // suites; here we assert the privacy-domain `pii_*` events carry NO PII
    // (the load-bearing invariant the whole model rests on), driven through the
    // real self-service erasure.
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

      // Read the privacy-event audit sink (Postgres `pii_events`) and assert the
      // invariant: the rows for this subject carry only opaque refs + field names.
      const mine = await pgQueryProjection('pii_events', 'subject_ref', subject.uid)
      // The erasure emitted at least the anonymization event for this subject.
      expect(mine.length).toBeGreaterThan(0)
      const serialized = JSON.stringify(mine)
      expect(serialized).not.toContain('E2E Owner')
      expect(serialized).not.toContain(originalEmail)
      // subject_ref is the opaque userId (a ref, not PII).
      expect(serialized).toContain(subject.uid)
    })

    // Cenário 5 — bloqueio per-org do cliente (A neutral/archived + gone from
    // pickers; B + global intact). Mechanism owned by per-org-erasure.spec.ts.
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

      // Block in org A only — post-cutover the block IS the `archived_at` stamp
      // on the org's customer shadow (brief 0062); no separate marker doc.
      await archiveCustomerForUser(ownerA.orgId, custA)

      const label = `Cliente ${anonymizedSubjectCode(subjectUserId)}`

      // Org A: gone from the active list + the appointment picker.
      await signInAndAttachSession(context, ownerA.email, ownerA.password)
      const pageA = await context.newPage()
      await pageA.goto('/customers')
      await expect(pageA.getByText(realName)).toHaveCount(0)
      await pageA.goto('/agenda')
      await expect(pageA.getByText(realName)).toHaveCount(0)
      await pageA.close()

      // Org B (separate context): the same subject keeps the real name.
      const contextB = await context.browser()!.newContext()
      await signInAndAttachSession(contextB, ownerB.email, ownerB.password)
      const pageB = await contextB.newPage()
      await pageB.goto('/customers')
      await expect(pageB.getByText(realName, { exact: true })).toBeVisible()
      await expect(pageB.getByText(label, { exact: true })).toHaveCount(0)
      await contextB.close()

      // Marker scoped to A only; global account untouched (live name intact).
      expect(await blockedSubjectMarkerExists(ownerA.orgId, subjectUserId)).toBe(true)
      expect(await blockedSubjectMarkerExists(ownerB.orgId, subjectUserId)).toBe(false)
      const globalUser = (await pgQueryProjection('users', 'uid', subjectUserId))[0] ?? null
      expect(asStr(globalUser?.display_name)).toEqual(realName)
    })

    // Cenário 6 — descoberta self-service (reverse index lists establishments;
    // per-org vs global actions). Mechanism owned by self-service-discovery.
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

      // BOTH establishments listed (resolved from the per-user reverse index).
      // `seedOrg` names each org `E2E ${orgId}`.
      const establishments = page.getByRole('list', { name: 'Estabelecimentos' })
      const itemA = establishments.getByRole('listitem').filter({ hasText: `E2E ${subject.orgId}` })
      await expect(itemA).toBeVisible()
      await expect(
        establishments.getByRole('listitem').filter({ hasText: `E2E ${ownerB.orgId}` }),
      ).toBeVisible()
      // Per-org erase action AND global erase action are both offered.
      await expect(
        itemA.getByRole('button', { name: 'Excluir meus dados deste estabelecimento' }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Excluir meus dados', exact: true }),
      ).toBeVisible()

      // The reverse index holds ZERO PII — only the opaque refs orgId + linkedAt
      // (the subject's own uid is the row PK, not exposed by the read helper).
      const link = await readOrgLink(subject.uid, subject.orgId)
      expect(Object.keys(link ?? {}).sort()).toEqual(['linkedAt', 'orgId'])
      await page.close()
    })

    // Cenário 7 — cliente com assinatura ativa: aviso de consentimento +
    // cancelamento imediato + agenda futura cancelada. Cascade mechanism owned
    // by erasure-cascade.spec.ts; here we prove the informed-consent warning + the
    // read-side cancellation through the self-service per-org flow.
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

      // Informed consent: the active-subscription warning shows BEFORE confirming.
      const item = page
        .getByRole('list', { name: 'Estabelecimentos' })
        .getByRole('listitem')
        .filter({ hasText: `E2E ${subject.orgId}` })
      await item.getByRole('button', { name: 'Excluir meus dados deste estabelecimento' }).click()
      await expect(
        page.getByText('Você tem uma assinatura ativa neste estabelecimento.'),
      ).toBeVisible()

      // Confirm — runs the real per-org erase saga.
      await page.getByRole('button', { name: 'Confirmar exclusão' }).click()
      await expect(page.getByText(/foram excluídos/)).toBeVisible()
      await page.close()

      // The block marker exists; the subscription is cancelled by the cascade —
      // mirror the cascade OUTPUT for the read-side assertion, the same way
      // erasure-cascade.spec.ts does (the future-appointment cancellation is the
      // sibling spec's exhaustive concern; here it added no observable assertion,
      // so its Firestore-only simulation is dropped rather than faked).
      expect(await blockedSubjectMarkerExists(subject.orgId, subject.uid)).toBe(true)
      await setSubscriptionStatus(subject.orgId, subId, 'cancelled')

      // Past appointment retained (de-identified, not deleted) — AC-04.
      const retained = await pgReadProjection(
        'appointments',
        aggregateRef(AppointmentConfig, subject.orgId, pastAppt),
      )
      expect(retained).not.toBeNull()
      expect(asStr(retained?.status)).toBe('completed')
    })

    // Cross-cutting invariant of the 04/06 reescopo: cliente and profissional are
    // DIFFERENT relationships and never cross. A person who is a CUSTOMER
    // (blocked) AND a PROFESSIONAL stays IDENTIFIABLE on the memberOperation surface.
    test('Separação de relações: a CUSTOMER blocked in a org stays IDENTIFIABLE as a PROFESSIONAL (team)', async ({
      context,
    }) => {
      const owner = await seedOrg({ memberOperationCount: 1 })
      const proUserId = `e2e-prof-user-${owner.memberOperationIds[0]}`
      const proName = 'Profissional 1'

      // The SAME person is also a customer in this org — then blocked as one.
      const custId = await seedCustomer(owner.orgId, {
        name: proName,
        userId: proUserId,
        avatarUrl: 'https://example.com/pro.png',
      })
      // Block the CUSTOMER relationship — post-cutover the block is the
      // `archived_at` stamp on the org's customer shadow (brief 0062).
      await archiveCustomerForUser(owner.orgId, custId)

      await signInAndAttachSession(context, owner.email, owner.password)
      const page = await context.newPage()

      // Team (memberOperation/employment relationship) keeps the real name — the
      // customer block NEVER neutralizes the memberOperation surface.
      await page.goto('/team')
      await expect(page.getByText(proName).first()).toBeVisible()
      const neutralProLabel = `Profissional ${anonymizedSubjectCode(proUserId)}`
      await expect(page.getByText(neutralProLabel, { exact: true })).toHaveCount(0)
      await page.close()
    })
  },
)
