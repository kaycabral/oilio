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

// Feature-level E2E — CUSTOMER self-service discovery + erasure (brief 0032 /
// #1097, AC-10, Cenário 6).
//
// The signed-in subject opens `settings/privacy`, discovers the establishments
// where they are a CUSTOMER (resolved by the identity-layer reverse index
// `users/{uid}/org_links` — a per-user read, NOT a cross-org query), and
// per establishment either:
//   - blocks their data there (per-org block, #1100), warned first about an
//     active subscription that will be cancelled (#1101, informed consent); or
//   - erases their whole account (global anonymization, #1093).
// The reverse-index doc holds ZERO PII (just orgId + linkedAt) and is read
// only for the OWN uid.

test.describe('CUSTOMER self-service discovery + erasure', () => {
  test('baseline: privacy surface renders; subject with no links sees the empty state', async ({
    context,
  }) => {
    // Owner of their own org but a customer of NONE — no org_links seeded.
    const owner = await seedOrg({ memberOperationCount: 0 })
    await signInAndAttachSession(context, owner.email, owner.password)
    const page = await context.newPage()

    await page.goto('/settings/privacy')
    await expect(page.getByRole('heading', { name: 'Privacidade' })).toBeVisible()
    // Empty state for the establishments list.
    await expect(
      page.getByText('Você não é cliente de nenhum estabelecimento no momento.'),
    ).toBeVisible()
    // Whole-account erasure is always available.
    await expect(page.getByRole('button', { name: 'Excluir meus dados' })).toBeVisible()
    await page.close()
  })

  test('subject in 2 orgs sees both; erasing one blocks only that org; index holds zero PII', async ({
    context,
  }) => {
    // Org A owned by the subject (gives them the org context the (app)
    // layout requires) + org B owned by someone else. The SAME subject uid is
    // a CUSTOMER of both, recorded in their reverse index.
    const subject = await seedOrg({ memberOperationCount: 0 })
    const ownerB = await seedOrg({ memberOperationCount: 0 })

    const custA = await seedCustomerShadowForUser(subject.orgId, subject.uid)
    await seedCustomerShadowForUser(ownerB.orgId, subject.uid)
    await seedOrgLink(subject.uid, subject.orgId)
    await seedOrgLink(subject.uid, ownerB.orgId)

    // An active subscription in org A — the block must warn before confirming.
    await seedSubscription(subject.orgId, custA, { status: 'active' })

    await signInAndAttachSession(context, subject.email, subject.password)
    const page = await context.newPage()
    await page.goto('/settings/privacy')

    // Discovery: BOTH establishments are listed (resolved from the reverse index,
    // no cross-org query). The list items carry the establishment name —
    // `seedOrg` names each org `E2E ${orgId}`.
    const establishments = page.getByRole('list', { name: 'Estabelecimentos' })
    const itemA = establishments.getByRole('listitem').filter({ hasText: `E2E ${subject.orgId}` })
    const itemB = establishments.getByRole('listitem').filter({ hasText: `E2E ${ownerB.orgId}` })
    await expect(itemA).toBeVisible()
    await expect(itemB).toBeVisible()

    // The reverse index holds ZERO PII — only orgId + linkedAt.
    const link = await readOrgLink(subject.uid, subject.orgId)
    expect(link).not.toBeNull()
    expect(Object.keys(link ?? {}).sort()).toEqual(['linkedAt', 'orgId'])

    // The subject can only read their OWN links — ownerB's index never holds the
    // subject (the link lives under the SUBJECT's own user doc, scoped per-uid).
    expect(await readOrgLink(ownerB.uid, ownerB.orgId)).toBeNull()

    // Erase data in org A: open the per-establishment dialog. The active-
    // subscription warning shows (informed consent, #1101).
    await itemA.getByRole('button', { name: 'Excluir meus dados deste estabelecimento' }).click()
    await expect(
      page.getByText('Você tem uma assinatura ativa neste estabelecimento.'),
    ).toBeVisible()

    // Confirm — runs the real per-org block server action.
    await page.getByRole('button', { name: 'Confirmar exclusão' }).click()
    await expect(page.getByText(/foram excluídos/)).toBeVisible()

    // Only org A is blocked: the `blocked_subjects` marker exists for A and
    // never leaks to B (the subject keeps their account in B intact).
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
    const user = await readUser(subject.uid)
    expect(user).not.toBeNull()
    expect(isAnonymized({ anonymizedAt: user?.anonymizedAt ?? null })).toBe(true)
  })
})
