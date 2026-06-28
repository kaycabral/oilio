import { CustomerConfig } from '@/domain/aggregates/customer/config'
import { aggregateRef } from '@/domain/effect'
import { randomBytes } from 'node:crypto'
import { expect, test } from '../fixtures'
import { fillBirthDate } from '../helpers/forms'
import {
  pgQueryProjection,
  pgReadProjection,
  seedAuthUser,
  seedCustomer,
  seedOrg,
  signInAndAttachSession,
  timestamptzToIso,
} from '../helpers/session'

// #839 — Customer dedupe by WhatsApp via OAuth completion. When a stub
// User exists (created by the recepcionista path with `claimedAt: null`)
// and the same human later signs in via OAuth, the completion step
// (#838) folds the stub into the OAuth user: every Customer / Membership
// / Appointment FK is re-pointed and the stub User doc is deleted.
//
// Golden path covered here: receptionist seeds a Customer with WhatsApp X
// → fresh OAuth user signs in → completes profile with the same WhatsApp
// → assert 1 Customer in the org, pointing to the OAuth uid; stub User
// doc is gone; OAuth user is `completionCompleted=true` and `claimedAt`
// is set.

// Builds a stub Customer (User stub + Customer doc) with full control over
// the resulting stub uid — the public `seedCustomer` helper accepts a
// `userId` override, which is precisely what this spec needs to observe the
// stub before & after the merge. The override produces a User with
// `completionCompleted=false` + `claimedAt=null` (the receptionist-path stub
// shape, per `buildUser`) and a per-org Customer shadow pointing at it.
async function seedStubCustomer(
  orgId: string,
  opts: { whatsapp: string; name?: string },
): Promise<{ customerId: string; stubUid: string }> {
  const stubUid = `stub-${Date.now()}-${randomBytes(4).toString('hex')}`
  const customerId = await seedCustomer(orgId, {
    userId: stubUid,
    whatsapp: opts.whatsapp,
    name: opts.name ?? 'Stub Customer',
  })
  return { customerId, stubUid }
}

// Reads the `user_id` FK off the per-org Customer projection in Postgres
// (snake_case column). Returns null when the customer row is absent.
async function readCustomerUserId(orgId: string, customerId: string): Promise<string | null> {
  const row = await pgReadProjection('customers', aggregateRef(CustomerConfig, orgId, customerId))
  if (!row) return null
  return typeof row.user_id === 'string' ? row.user_id : null
}

// Reads the global `users` row by uid (Postgres, post-cutover). Returns null
// when the row is absent — the stub user is hard-deleted by the merge.
async function readUserRow(uid: string): Promise<Record<string, unknown> | null> {
  const rows = await pgQueryProjection('users', 'uid', uid)
  return rows[0] ?? null
}

test.describe('Deduplicação de Cliente via conclusão OAuth (#839)', { tag: '@critical' }, () => {
  test('Conclusão OAuth funde o Cliente stub da recepção quando WhatsApp bate', async ({
    context,
    page,
    baseURL,
  }) => {
    // 1. Receptionist has already added "Maria" to her Customer book — stub
    //    User (random uid, claimedAt: null) + Customer doc in the org.
    const org = await seedOrg({ unitCount: 1, memberOperationCount: 1 })
    const sharedWhatsapp = '5511988887777'
    const { customerId, stubUid } = await seedStubCustomer(org.orgId, {
      whatsapp: sharedWhatsapp,
      name: 'Maria (digitada pela recepção)',
    })

    // 2. The same human shows up via OAuth (we simulate by creating a new
    //    Firebase Auth user with completionCompleted=false — the flow that
    //    Google/Microsoft sign-in lands on).
    const claimer = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, claimer.email, claimer.password, baseURL ?? undefined)

    // 3. Completion form — same WhatsApp as the stub, different name. Per
    //    the data-ownership rule, the OAuth-provided name wins.
    await page.goto('/onboarding/profile')
    await expect(page).toHaveURL(/\/onboarding\/profile/)
    await page.getByRole('textbox', { name: /nome/i }).fill('Maria (cadastrada pelo OAuth)')
    await page.getByRole('textbox', { name: /whatsapp/i }).fill('11988887777')
    await fillBirthDate(page, '10/05/1990')
    await page.getByRole('button', { name: /continuar/i }).click()

    // Bounce off the completion page once the action returns.
    await expect(page).not.toHaveURL(/\/onboarding\/profile/, { timeout: 10_000 })

    // 4. Customer doc is intact in the org but now points to the OAuth uid.
    const customerUserId = await readCustomerUserId(org.orgId, customerId)
    expect(customerUserId).not.toBeNull()
    expect(customerUserId).toBe(claimer.uid)

    // 5. Stub User doc is gone; the OAuth user is now claimed.
    const stub = await readUserRow(stubUid)
    expect(stub).toBeNull()
    const claimerUser = await readUserRow(claimer.uid)
    expect(claimerUser).not.toBeNull()
    expect(claimerUser?.whatsapp).toBe(sharedWhatsapp)
    expect(claimerUser?.completion_completed).toBe(true)
    // `claimed_at` is `timestamptz` (brief 0068 D1): on this raw read the pg
    // driver hands back a `Date`. Normalize to ISO and assert the claim was
    // stamped (a valid, non-null instant) rather than the JS type.
    const claimedAt = timestamptzToIso(claimerUser?.claimed_at)
    expect(claimedAt).not.toBeNull()
    expect(Number.isNaN(new Date(claimedAt ?? '').getTime())).toBe(false)
  })

  test('Conclusão OAuth sem stub correspondente não cria Cliente duplicado (sem efeito)', async ({
    context,
    page,
    baseURL,
  }) => {
    // Org + owner exist (the layout pulls a org context for the post-
    // completion redirect), but no stub Customer is seeded — fresh WhatsApp.
    await seedOrg({ unitCount: 1, memberOperationCount: 1 })

    const claimer = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, claimer.email, claimer.password, baseURL ?? undefined)

    await page.goto('/onboarding/profile')
    await page.getByRole('textbox', { name: /nome/i }).fill('Sem Stub')
    await page.getByRole('textbox', { name: /whatsapp/i }).fill('11955554444')
    await fillBirthDate(page, '20/02/1985')
    await page.getByRole('button', { name: /continuar/i }).click()

    await expect(page).not.toHaveURL(/\/onboarding\/profile/, { timeout: 10_000 })

    const u = await readUserRow(claimer.uid)
    expect(u).not.toBeNull()
    expect(u?.whatsapp).toBe('5511955554444')
    expect(u?.completion_completed).toBe(true)
  })
})
