import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { AUTH_HOST, FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { parseJson } from '../helpers/firestore-rest'
import { linkProfessionalToServices, seedService, signInAndAttachSession } from '../helpers/session'
import { MeAppointmentsPage, PublicBookingPage, orgSlug } from '../pages'

// Customer journey end-to-end — golden path do cliente final.
//
// Cobre o ciclo completo num único spec encadeado em vez de checks
// fragmentados, atravessando o que importa pro cliente final:
//   1. Customer autentica (surrogate de OAuth — auth emulator faz
//      password-auth; a sessão resultante é equivalente do ponto de
//      vista do app).
//   2. Wizard self-book unit-scoped: catálogo → availability → confirm
//      → success. ConfirmBookingForm pré-popula nome + WhatsApp do
//      User logado.
//   3. Customer abre `/me/appointments`, vê o appointment recém-criado.
//   4. Self-cancel dentro da janela da política.
//   5. Página reflete status `Cancelado`.
//
// Origem: issue #837 (marco V0.1 do scheduling). A versão é histórica —
// a essência do spec é "o cliente consegue ir do zero até cancelar",
// independente da milestone do produto.

const API_KEY = 'fake-api-key'

function fsPatchFull(path: string, body: unknown) {
  // PATCH without updateMask — Firestore treats this as full-doc upsert.
  // (When mask is present it'd only merge listed paths; mask-less is
  // simpler for seeds.)
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

function curlJson<T>(url: string, body: unknown, decode: (u: unknown) => T): T {
  const out = execFileSync(
    'curl',
    ['-fsS', '-X', 'POST', url, '-H', 'Content-Type: application/json', '-d', JSON.stringify(body)],
    { encoding: 'utf8' },
  )
  return parseJson(out, decode)
}

// Stand up a fresh customer User via Auth REST + matching `users/{uid}`
// doc with completion=true so the wizard's session prefill kicks in.
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
  fsPatchFull(`users/${uid}`, {
    fields: {
      uid: { stringValue: uid },
      email: { stringValue: email },
      displayName: { stringValue: 'Joana Golden' },
      avatarUrl: { nullValue: null },
      emailVerified: { booleanValue: true },
      currentOrgId: { nullValue: null },
      whatsapp: { stringValue: `5511${Math.floor(900000000 + Math.random() * 99999999)}` },
      // A COMPLETED account (`completionCompleted: true`) REQUIRES a string
      // birthDate — the `UserComplete` branch rejects null. A null here made the
      // doc fail every union branch and crashed the strict-decoding read.
      birthDate: { stringValue: '1990-01-01' },
      taxIdentity: { nullValue: null },
      bio: { nullValue: null },
      specialties: { nullValue: null },
      completionCompleted: { booleanValue: true },
      claimedAt: { stringValue: now },
      termsAcceptedAt: { nullValue: null },
      termsVersion: { nullValue: null },
      privacyAcceptedAt: { nullValue: null },
      privacyVersion: { nullValue: null },
      anonymizedAt: { nullValue: null },
      createdAt: { stringValue: now },
      updatedAt: { stringValue: now },
    },
  })
  return Promise.resolve({ uid, email, password })
}

test.describe('Jornada do cliente — caminho feliz', { tag: ['@journey', '@critical'] }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      professionalCount: 1,
      cancellationPolicy: { enabled: true, minNoticeMinutes: 60 },
    },
  })

  test('cliente loga, faz auto-agendamento via wizard e depois auto-cancela', async ({
    org,
    context,
    page,
    baseURL,
  }) => {
    const slug = orgSlug(org.orgId)
    const unitId = org.unitIds[0]!
    const serviceId = seedService(org.orgId, {
      name: 'Golden Path Corte',
      durationMinutes: 30,
      priceCents: 6500,
      publicVisible: true,
      unitIds: [unitId],
    })
    linkProfessionalToServices(org.orgId, org.professionalIds[0]!, [serviceId])

    // 1. Customer authentication (separate identity from the org owner).
    const customer = await createCustomerUser()
    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

    const booking = new PublicBookingPage(page, slug)

    // 2. Self-book via wizard — catalog → availability → confirm → success.
    const targetDate = nextWeekday('Wed')
    await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
    await booking
      .slotByProfessional(/profissional 1/i)
      .first()
      .click()
    // Pre-fill from session is the #864 finalize.
    await expect(page.getByText(/Confirme os dados abaixo/i)).toBeVisible()
    await expect(page.getByRole('textbox', { name: /seu nome/i })).toHaveValue('Joana Golden')
    await booking.confirmButton().click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1/book/success\\?appt=`))
    await expect(booking.successHeading()).toBeVisible()
    await expect(page.getByText(/Golden Path Corte/)).toBeVisible()

    // 3. /me/appointments lists the new appointment.
    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(page.getByRole('heading', { name: /meus agendamentos/i })).toBeVisible()
    await expect(me.appointmentByService('Golden Path Corte')).toBeVisible()

    // 4. Self-cancel (target slot is 09:00 BR on a future weekday → way
    //    outside the 60-min policy window).
    page.on('dialog', (d) => d.accept())
    await me.cancelButton().click()

    // 5. Page reflects cancelled state.
    await expect(page.getByText(/cancelado/i).first()).toBeVisible()
  })
})
