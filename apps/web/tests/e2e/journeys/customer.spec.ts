import { putUser } from '@/shared/db/pg/users-store'
import { buildUser } from '@/shared/fixtures/domain-builders'
import { Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { AUTH_HOST } from '../helpers/emulator'
import { parseJson } from '../helpers/rest-json'
import {
  linkMemberOperationToServices,
  seedService,
  signInAndAttachSession,
  uniqueWhatsapp,
} from '../helpers/session'
import { MeAppointmentsPage, PublicBookingPage, orgSlug } from '../pages'

const API_KEY = 'fake-api-key'

function curlJson<T>(url: string, body: unknown, decode: (u: unknown) => T): T {
  const out = execFileSync(
    'curl',
    ['-fsS', '-X', 'POST', url, '-H', 'Content-Type: application/json', '-d', JSON.stringify(body)],
    { encoding: 'utf8' },
  )
  return parseJson(out, decode)
}

async function createCustomerUser() {
  const email = `e2e-customer-${Math.random().toString(36).slice(2, 10)}@example.com`
  const password = 'E2E12345!'
  const su = curlJson(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { email, password, returnSecureToken: true },
    Schema.decodeUnknownSync(Schema.Struct({ localId: Schema.String })),
  )
  const uid = su.localId
  const now = new Date().toISOString()
  await putUser(
    buildUser(uid, now, {
      email,
      displayName: 'Joana Golden',
      emailVerified: true,
      currentOrgId: null,
      mobile: uniqueWhatsapp(),
      birthDate: '1990-01-01',
      completionCompleted: true,
      claimedAt: now,
    }),
  )
  return { uid, email, password }
}

test.describe('Jornada do cliente — caminho feliz', { tag: ['@journey', '@critical'] }, () => {
  test.use({
    orgInput: {
      unitCount: 1,
      memberOperationCount: 1,
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
    const serviceId = await seedService(org.orgId, {
      name: 'Golden Path Corte',
      durationMinutes: 30,
      priceCents: 6500,
      publicVisible: true,
      unitIds: [unitId],
    })
    await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

    const customer = await createCustomerUser()
    await signInAndAttachSession(context, customer.email, customer.password, baseURL ?? undefined)

    const booking = new PublicBookingPage(page, slug)

    const targetDate = nextWeekday('Wed')
    await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
    await booking
      .slotByMemberOperation(/profissional 1/i)
      .first()
      .click()
    await expect(booking.bookingAsNotice()).toContainText(/Joana Golden/)
    await booking.confirmButton().click()
    await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1/book/success\\?appt=`))
    await expect(booking.successHeading()).toBeVisible()
    await expect(page.getByText(/Golden Path Corte/)).toBeVisible()

    const me = new MeAppointmentsPage(page)
    await me.goto()
    await expect(page.getByRole('heading', { name: /meus agendamentos/i })).toBeVisible()
    await expect(me.appointmentByService('Golden Path Corte')).toBeVisible()

    page.on('dialog', (d) => d.accept())
    await me.cancelButton().click()

    await expect(page.getByText(/cancelado/i).first()).toBeVisible()
  })
})
