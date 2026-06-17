import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from './fixtures'
import { AUTH_HOST, FIRESTORE_HOST, PROJECT_ID } from './helpers/emulator'
import { decodeFsDocument, parseJson, strField } from './helpers/firestore-rest'
import { seedAppointment, seedService, seedTenant, signInAndAttachSession } from './helpers/session'
import { MeAppointmentsPage } from './pages'

// Issue #845 — Cliente self-cancel a partir de /me/appointments.
//
// Cobre o golden path (cancel dentro da janela) + gate de policy (botão
// disabled quando a antecedência mínima já foi violada).

const API_KEY = 'fake-api-key'

function curlJson<T>(url: string, body: unknown, decode: (u: unknown) => T): T {
  const out = execFileSync(
    'curl',
    ['-fsS', '-X', 'POST', url, '-H', 'Content-Type: application/json', '-d', JSON.stringify(body)],
    { encoding: 'utf8' },
  )
  return parseJson(out, decode)
}

function fsPatch(path: string, body: unknown) {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify(body),
    ],
    { encoding: 'utf8' },
  )
}

function fsGet<T>(path: string, decode: (u: unknown) => T): T {
  const out = execFileSync(
    'curl',
    [
      '-fsS',
      `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
      '-H',
      'Authorization: Bearer owner',
    ],
    { encoding: 'utf8' },
  )
  return parseJson(out, decode)
}

// Sign up a fresh User via Auth REST + write the matching `users/{uid}`
// doc so it looks like a legitimate customer identity. Returns the uid +
// credentials so the test can sign in as that customer later.
function createCustomerUser() {
  const email = `e2e-customer-${Math.random().toString(36).slice(2, 10)}@example.com`
  const password = 'E2E12345!'
  const su = curlJson(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { email, password, returnSecureToken: true },
    Schema.decodeUnknownSync(Schema.Struct({ localId: Schema.String })),
  )
  const uid = su.localId
  const now = new Date().toISOString()
  fsPatch(`users/${uid}`, {
    fields: {
      uid: { stringValue: uid },
      email: { stringValue: email },
      displayName: { stringValue: 'Cliente E2E' },
      avatarUrl: { nullValue: null },
      emailVerified: { booleanValue: true },
      currentTenantId: { nullValue: null },
      whatsapp: { stringValue: `5511${Math.floor(900000000 + Math.random() * 99999999)}` },
      birthDate: { nullValue: null },
      taxIdentity: { nullValue: null },
      bio: { nullValue: null },
      specialties: { nullValue: null },
      completionCompleted: { booleanValue: true },
      claimedAt: { stringValue: now },
      termsAcceptedAt: { nullValue: null },
      termsVersion: { nullValue: null },
      privacyAcceptedAt: { nullValue: null },
      privacyVersion: { nullValue: null },
      createdAt: { stringValue: now },
      updatedAt: { stringValue: now },
    },
  })
  return Promise.resolve({ uid, email, password })
}

function seedCustomerForUser(tenantId: string, uid: string): string {
  const customerId = `e2e-cust-${Math.random().toString(36).slice(2, 10)}`
  const now = new Date().toISOString()
  fsPatch(`tenants/${tenantId}/customers/${customerId}`, {
    fields: {
      id: { stringValue: customerId },
      tenantId: { stringValue: tenantId },
      userId: { stringValue: uid },
      tags: { arrayValue: { values: [{ stringValue: 'wizard' }] } },
      notes: { nullValue: null },
      createdAt: { stringValue: now },
      updatedAt: { stringValue: now },
    },
  })
  return customerId
}

test.describe('Me — auto-cancelamento de cliente', { tag: '@critical' }, () => {
  test('cliente cancela seu agendamento dentro da janela', async ({ context, page, baseURL }) => {
    // Tenant with policy enabled @ 60 min notice. The appointment is 3h
    // ahead → safely within the window. Customer signs in as a separate
    // identity (not the tenant owner), so we bypass `authedPage` and use
    // the imperative `signInAndAttachSession` with the customer creds.
    const seed = await seedTenant({
      unitCount: 1,
      professionalCount: 1,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 60 },
    })
    const serviceId = seedService(seed.tenantId, {
      name: 'Corte',
      publicVisible: true,
      unitIds: seed.unitIds,
    })
    const customer = await createCustomerUser()
    const customerId = seedCustomerForUser(seed.tenantId, customer.uid)
    const startAt = new Date(Date.now() + 3 * 60 * 60_000).toISOString()
    const endAt = new Date(Date.now() + 3.5 * 60 * 60_000).toISOString()
    const apptId = seedAppointment({
      tenantId: seed.tenantId,
      unitId: seed.unitIds[0]!,
      professionalId: seed.professionalIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      // Snapshot mirrors the tenant policy at commit time (#1038).
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 60 },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    page.on('dialog', (d) => d.accept())

    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(page.getByRole('heading', { name: /meus agendamentos/i })).toBeVisible()
    await expect(me.appointmentByService('Corte')).toBeVisible()

    await me.cancelButton().click()
    // After the action, the row swaps to the "Cancelado" badge.
    await expect(page.getByText(/cancelado/i).first()).toBeVisible()

    // Confirm Firestore reflects the cancel + audit landed.
    const apptDoc = fsGet(`tenants/${seed.tenantId}/appointments/${apptId}`, decodeFsDocument)
    expect(strField(apptDoc.fields, 'status')).toBe('cancelled')
    expect(strField(apptDoc.fields, 'cancelledBy')).toBe('customer')
  })

  test('cliente não cancela dentro da janela — botão desabilitado com tooltip', async ({
    context,
    page,
    baseURL,
  }) => {
    // 2h policy; appointment 30 min ahead → outside the window.
    const seed = await seedTenant({
      unitCount: 1,
      professionalCount: 1,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 120 },
    })
    const serviceId = seedService(seed.tenantId, {
      name: 'Corte Tight',
      publicVisible: true,
      unitIds: seed.unitIds,
    })
    const customer = await createCustomerUser()
    const customerId = seedCustomerForUser(seed.tenantId, customer.uid)
    const startAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const endAt = new Date(Date.now() + 60 * 60_000).toISOString()
    seedAppointment({
      tenantId: seed.tenantId,
      unitId: seed.unitIds[0]!,
      professionalId: seed.professionalIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      // Snapshot mirrors the tenant policy at commit time (#1038).
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 120 },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(me.cancelButton()).toBeDisabled()
    await expect(page.getByText(/2\s*horas\s*de\s*antecedência/i)).toBeVisible()
  })

  test('elegibilidade usa o snapshot da policy, não a policy viva do tenant (#1038)', async ({
    context,
    page,
    baseURL,
  }) => {
    // Booking committed under a strict policy (enabled @ 120 min). The
    // appointment is 30 min ahead → inside the window → blocked by the
    // snapshot. The owner then relaxes the LIVE tenant policy to disabled.
    // Snapshot-on-use means the customer's right to cancel must still be
    // evaluated against policy X (the snapshot), so the button stays disabled.
    const seed = await seedTenant({
      unitCount: 1,
      professionalCount: 1,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 120 },
    })
    const serviceId = seedService(seed.tenantId, {
      name: 'Corte Snapshot',
      publicVisible: true,
      unitIds: seed.unitIds,
    })
    const customer = await createCustomerUser()
    const customerId = seedCustomerForUser(seed.tenantId, customer.uid)
    const startAt = new Date(Date.now() + 30 * 60_000).toISOString()
    const endAt = new Date(Date.now() + 60 * 60_000).toISOString()
    seedAppointment({
      tenantId: seed.tenantId,
      unitId: seed.unitIds[0]!,
      professionalId: seed.professionalIds[0]!,
      customerId,
      serviceId,
      startAt,
      endAt,
      // Frozen at commit: strict 120-min policy.
      cancellationPolicySnapshot: { enabled: true, minNoticeMinutes: 120 },
    })

    // Owner relaxes the LIVE tenant policy AFTER the booking. If the read-site
    // wrongly used the live policy, the button would become enabled.
    fsPatch(`tenants/${seed.tenantId}?updateMask.fieldPaths=cancellationPolicy`, {
      fields: {
        cancellationPolicy: {
          mapValue: {
            fields: {
              enabled: { booleanValue: false },
              minNoticeMinutes: { integerValue: '0' },
            },
          },
        },
      },
    })

    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)
    const me = new MeAppointmentsPage(page)
    await me.goto()
    // Snapshot (120 min) still governs → cancel stays blocked.
    await expect(me.cancelButton()).toBeDisabled()
    await expect(page.getByText(/2\s*horas\s*de\s*antecedência/i)).toBeVisible()
  })
})
