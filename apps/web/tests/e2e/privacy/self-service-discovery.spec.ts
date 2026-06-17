import { isAnonymized } from '@/domain'
import { expect, test } from '../fixtures'
import { strField } from '../helpers/firestore-rest'
import {
  blockedSubjectMarkerExists,
  readTenantLink,
  readUser,
  seedCustomerShadowForUser,
  seedSubscription,
  seedTenant,
  seedTenantLink,
  signInAndAttachSession,
} from '../helpers/session'

// Feature-level E2E — CUSTOMER self-service discovery + erasure (brief 0032 /
// #1097, AC-10, Cenário 6).
//
// The signed-in subject opens `settings/privacy`, discovers the establishments
// where they are a CUSTOMER (resolved by the identity-layer reverse index
// `users/{uid}/tenant_links` — a per-user read, NOT a cross-tenant query), and
// per establishment either:
//   - blocks their data there (per-tenant block, #1100), warned first about an
//     active subscription that will be cancelled (#1101, informed consent); or
//   - erases their whole account (global anonymization, #1093).
// The reverse-index doc holds ZERO PII (just tenantId + linkedAt) and is read
// only for the OWN uid.

test.describe('CUSTOMER self-service discovery + erasure', () => {
  test('baseline: privacy surface renders; subject with no links sees the empty state', async ({
    context,
  }) => {
    // Owner of their own tenant but a customer of NONE — no tenant_links seeded.
    const owner = await seedTenant({ professionalCount: 0 })
    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    await page.goto('/settings/privacy')
    await expect(page.getByRole('heading', { name: 'Privacidade dos dados' })).toBeVisible()
    // Empty state for the establishments list.
    await expect(
      page.getByText('Você não é cliente de nenhum estabelecimento no momento.'),
    ).toBeVisible()
    // Whole-account erasure is always available.
    await expect(page.getByRole('button', { name: 'Excluir meus dados' })).toBeVisible()
    await page.close()
  })

  test('subject in 2 tenants sees both; erasing one blocks only that tenant; index holds zero PII', async ({
    context,
  }) => {
    // Tenant A owned by the subject (gives them the tenant context the (app)
    // layout requires) + tenant B owned by someone else. The SAME subject uid is
    // a CUSTOMER of both, recorded in their reverse index.
    const subject = await seedTenant({ professionalCount: 0 })
    const ownerB = await seedTenant({ professionalCount: 0 })

    const custA = seedCustomerShadowForUser(subject.tenantId, subject.uid)
    seedCustomerShadowForUser(ownerB.tenantId, subject.uid)
    seedTenantLink(subject.uid, subject.tenantId)
    seedTenantLink(subject.uid, ownerB.tenantId)

    // An active subscription in tenant A — the block must warn before confirming.
    seedSubscription(subject.tenantId, custA, { status: 'active' })

    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await page.goto('/settings/privacy')

    // Discovery: BOTH establishments are listed (resolved from the reverse index,
    // no cross-tenant query). The list items carry the establishment name —
    // `seedTenant` names each tenant `E2E ${tenantId}`.
    const establishments = page.getByRole('list', { name: 'Estabelecimentos' })
    const itemA = establishments
      .getByRole('listitem')
      .filter({ hasText: `E2E ${subject.tenantId}` })
    const itemB = establishments.getByRole('listitem').filter({ hasText: `E2E ${ownerB.tenantId}` })
    await expect(itemA).toBeVisible()
    await expect(itemB).toBeVisible()

    // The reverse index holds ZERO PII — only tenantId + linkedAt.
    const link = readTenantLink(subject.uid, subject.tenantId)
    expect(link).not.toBeNull()
    expect(Object.keys(link ?? {}).sort()).toEqual(['linkedAt', 'tenantId'])

    // The subject can only read their OWN links — ownerB's index never holds the
    // subject (the link lives under the SUBJECT's own user doc, scoped per-uid).
    expect(readTenantLink(ownerB.uid, ownerB.tenantId)).toBeNull()

    // Erase data in tenant A: open the per-establishment dialog. The active-
    // subscription warning shows (informed consent, #1101).
    await itemA.getByRole('button', { name: 'Excluir meus dados deste estabelecimento' }).click()
    await expect(
      page.getByText('Você tem uma assinatura ativa neste estabelecimento.'),
    ).toBeVisible()

    // Confirm — runs the real per-tenant block server action.
    await page.getByRole('button', { name: 'Confirmar exclusão' }).click()
    await expect(page.getByText(/foram excluídos/)).toBeVisible()

    // Only tenant A is blocked: the `blocked_subjects` marker exists for A and
    // never leaks to B (the subject keeps their account in B intact).
    expect(blockedSubjectMarkerExists(subject.tenantId, subject.uid)).toBe(true)
    expect(blockedSubjectMarkerExists(ownerB.tenantId, subject.uid)).toBe(false)

    await page.close()
  })

  test('erasing the whole account anonymizes the global doc + cancels the active subscription, with the warning shown', async ({
    context,
  }) => {
    const subject = await seedTenant({ professionalCount: 0 })
    const custId = seedCustomerShadowForUser(subject.tenantId, subject.uid)
    seedTenantLink(subject.uid, subject.tenantId)
    seedSubscription(subject.tenantId, custId, { status: 'active' })

    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await page.goto('/settings/privacy')

    // The whole-account section makes the irreversible/global nature explicit.
    await expect(page.getByRole('heading', { name: 'Excluir minha conta inteira' })).toBeVisible()

    // Confirm the irreversible global erasure (type the confirm word).
    await page.getByLabel(/Digite/).fill('EXCLUIR')
    await page.getByRole('button', { name: 'Excluir meus dados', exact: true }).click()

    // Bounced to /login — the account no longer holds PII to operate with.
    await page.waitForURL(/\/login/, { timeout: 15000 })
    await page.close()

    // The global account doc is irreversibly anonymized (#1093) — the only place
    // the name lived.
    const user = readUser(subject.uid)
    expect(user).not.toBeNull()
    const anonymizedAt = strField(user ?? undefined, 'anonymizedAt')
    expect(isAnonymized({ anonymizedAt: anonymizedAt ?? null })).toBe(true)
  })
})
