import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { FsValueSchema, decodeFsDocument, parseJson } from '../helpers/firestore-rest'
import { fillBirthDate } from '../helpers/forms'
import { readUser, seedAuthUser, seedOrg, signInAndAttachSession } from '../helpers/session'

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

function fsBaseUrl() {
  return `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
}

function curlJson<T>(args: string[], decode: (u: unknown) => T): T {
  const out = execFileSync('curl', ['-fsS', ...args], { encoding: 'utf8' })
  return parseJson(out, decode)
}

// Builds a stub Customer (User stub + Customer doc) with full control over
// the resulting ids — the public `seedCustomer` helper hides the stub uid
// behind a random suffix, which is precisely what this spec needs to
// observe before & after the merge.
function seedStubCustomer(
  orgId: string,
  opts: { whatsapp: string; name?: string },
): { customerId: string; stubUid: string } {
  const stubUid = `stub-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  const customerId = `stub-cust-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
  const name = opts.name ?? 'Stub Customer'
  const now = new Date().toISOString()

  curlJson(
    [
      '-X',
      'PATCH',
      `${fsBaseUrl()}/users/${stubUid}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          uid: { stringValue: stubUid },
          email: { nullValue: null },
          displayName: { stringValue: name },
          avatarUrl: { nullValue: null },
          emailVerified: { booleanValue: false },
          currentOrgId: { nullValue: null },
          whatsapp: { stringValue: opts.whatsapp },
          birthDate: { nullValue: null },
          taxIdentity: { nullValue: null },
          bio: { nullValue: null },
          specialties: { nullValue: null },
          completionCompleted: { booleanValue: false },
          claimedAt: { nullValue: null },
          termsAcceptedAt: { nullValue: null },
          termsVersion: { nullValue: null },
          privacyAcceptedAt: { nullValue: null },
          privacyVersion: { nullValue: null },
          createdAt: { stringValue: now },
          updatedAt: { stringValue: now },
        },
      }),
    ],
    decodeFsDocument,
  )

  curlJson(
    [
      '-X',
      'PATCH',
      `${fsBaseUrl()}/organizations/${orgId}/customers/${customerId}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          id: { stringValue: customerId },
          orgId: { stringValue: orgId },
          userId: { stringValue: stubUid },
          tags: { arrayValue: { values: [] } },
          notes: { nullValue: null },
          createdAt: { stringValue: now },
          updatedAt: { stringValue: now },
        },
      }),
    ],
    decodeFsDocument,
  )

  return { customerId, stubUid }
}

const decodeReadCustomer = Schema.decodeUnknownSync(
  Schema.Struct({
    fields: Schema.optional(Schema.Record({ key: Schema.String, value: FsValueSchema })),
  }),
)

function readCustomer(orgId: string, customerId: string): Record<string, unknown> | null {
  try {
    const json = curlJson(
      [
        `${fsBaseUrl()}/organizations/${orgId}/customers/${customerId}`,
        '-H',
        'Authorization: Bearer owner',
      ],
      decodeReadCustomer,
    )
    return json.fields ?? null
  } catch {
    return null
  }
}

test.describe('Deduplicação de Cliente via conclusão OAuth (#839)', { tag: '@critical' }, () => {
  test('Conclusão OAuth funde o Cliente stub da recepção quando WhatsApp bate', async ({
    context,
    page,
    baseURL,
  }) => {
    // 1. Receptionist has already added "Maria" to her Customer book — stub
    //    User (random uid, claimedAt: null) + Customer doc in the org.
    const org = await seedOrg({ unitCount: 1, professionalCount: 1 })
    const sharedWhatsapp = '5511988887777'
    const { customerId, stubUid } = seedStubCustomer(org.orgId, {
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
    const customer = readCustomer(org.orgId, customerId) as {
      userId?: { stringValue?: string }
    } | null
    expect(customer).not.toBeNull()
    expect(customer!.userId?.stringValue).toBe(claimer.uid)

    // 5. Stub User doc is gone; the OAuth user is now claimed.
    const stub = readUser(stubUid)
    expect(stub).toBeNull()
    const claimerUser = readUser(claimer.uid) as {
      whatsapp?: { stringValue?: string }
      completionCompleted?: { booleanValue?: boolean }
      claimedAt?: { stringValue?: string; nullValue?: null }
    } | null
    expect(claimerUser).not.toBeNull()
    expect(claimerUser!.whatsapp?.stringValue).toBe(sharedWhatsapp)
    expect(claimerUser!.completionCompleted?.booleanValue).toBe(true)
    expect(typeof claimerUser!.claimedAt?.stringValue).toBe('string')
  })

  test('Conclusão OAuth sem stub correspondente não cria Cliente duplicado (sem efeito)', async ({
    context,
    page,
    baseURL,
  }) => {
    // Org + owner exist (the layout pulls a org context for the post-
    // completion redirect), but no stub Customer is seeded — fresh WhatsApp.
    await seedOrg({ unitCount: 1, professionalCount: 1 })

    const claimer = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, claimer.email, claimer.password, baseURL ?? undefined)

    await page.goto('/onboarding/profile')
    await page.getByRole('textbox', { name: /nome/i }).fill('Sem Stub')
    await page.getByRole('textbox', { name: /whatsapp/i }).fill('11955554444')
    await fillBirthDate(page, '20/02/1985')
    await page.getByRole('button', { name: /continuar/i }).click()

    await expect(page).not.toHaveURL(/\/onboarding\/profile/, { timeout: 10_000 })

    const u = readUser(claimer.uid) as {
      whatsapp?: { stringValue?: string }
      completionCompleted?: { booleanValue?: boolean }
    } | null
    expect(u).not.toBeNull()
    expect(u!.whatsapp?.stringValue).toBe('5511955554444')
    expect(u!.completionCompleted?.booleanValue).toBe(true)
  })
})
