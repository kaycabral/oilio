// Feature E2E for #1047 (brief 0028 AC-06/AC-07; surface moved to the member
// detail by brief 0037 #1085)
// (AC-06/AC-07 · DoD Cenário 2): a
// Professional's `operationalStatus` is DERIVED from real facts — never written
// by a UI input. A pro without WhatsApp/service stays `incomplete` and is NOT on
// the public agenda; completing the profile flips it to `operational`
// automatically (via the `professional.activated` domain event); there is NO UI
// path to write the status.
//
// Runs against the emulator (no mocks). The fixture seeds the pro `incomplete`
// with an empty serviceIds list; the linked User carries a whatsapp (read live,
// #1046) which we null out / restore via the Firestore REST emulator.

import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { seedService } from '../helpers/session'
import { ProfessionalsPage, PublicBookingPage, orgSlug } from '../pages'

function professionalUserId(professionalId: string): string {
  return `e2e-prof-user-${professionalId}`
}

// The `User` union forbids a COMPLETED account with a null whatsapp, so nulling
// whatsapp must also flip `completionCompleted` back to false (a legal
// `UserIncomplete`); restoring a whatsapp re-completes the account. Without this
// the doc fails every union branch and the strict-decoding read crashes the page.
function patchUserWhatsapp(uid: string, whatsapp: string | null): void {
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=whatsapp&updateMask.fieldPaths=completionCompleted`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      JSON.stringify({
        fields: {
          whatsapp: whatsapp === null ? { nullValue: null } : { stringValue: whatsapp },
          completionCompleted: { booleanValue: whatsapp !== null },
        },
      }),
    ],
    { stdio: 'pipe' },
  )
}

test.describe(
  'Professionals — status operacional derivado por evento (#1047)',
  { tag: '@critical' },
  () => {
    test.use({
      orgInput: {
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'incomplete',
      },
    })

    test('não há input de status — o status é texto read-only derivado', async ({
      org,
      authedPage,
    }) => {
      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoById(org.professionalIds[0]!)

      // Status renders read-only (derived). The pro starts `incomplete` (seeded,
      // no service yet).
      await expect(pros.operationalStatus()).toHaveText('Cadastro incompleto')

      // There is NO UI path to write the status (AC-06): no <select> and no
      // form field named `operationalStatus`.
      await expect(authedPage.locator('select[name="operationalStatus"]')).toHaveCount(0)
      await expect(authedPage.locator('[name="operationalStatus"]')).toHaveCount(0)
    })

    test('sem WhatsApp/serviço fica incompleto e não aparece na agenda pública', async ({
      org,
      authedPage,
      page,
    }) => {
      const proId = org.professionalIds[0]!
      const unitId = org.unitIds[0]!

      // Strip the linked User's WhatsApp — profile is now incomplete on two
      // axes (no whatsapp, no service).
      patchUserWhatsapp(professionalUserId(proId), null)

      // A public service exists in the unit, but the pro executes none of it
      // (serviceIds empty) — so they're off the public agenda regardless.
      const serviceId = seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoById(proId)
      await expect(pros.operationalStatus()).toHaveText('Cadastro incompleto')

      // Public availability for that service has no professional available
      // (the pro executes no service → off the agenda).
      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByProfessional('Profissional 1')).toHaveCount(0)
    })

    test('completar o perfil (unidade + serviço + WhatsApp) vira operacional sozinho', async ({
      org,
      authedPage,
      page,
    }) => {
      const proId = org.professionalIds[0]!
      const unitId = org.unitIds[0]!

      // WhatsApp present on the linked User (seeded), unit already linked.
      // Seed a service in the pro's unit and attach it through the operational
      // form — that mutation re-derives the status and emits
      // `professional.activated` (no manual status write anywhere).
      const serviceId = seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      const pros = new ProfessionalsPage(authedPage)
      await pros.gotoById(proId)
      await expect(pros.operationalStatus()).toHaveText('Cadastro incompleto')

      // Check the service and save — profile is now complete. The mutation
      // re-derives + emits the activation; post-#1085 the member detail stays
      // (no redirect), confirming in-place.
      await authedPage.getByRole('checkbox', { name: 'Corte' }).check()
      await pros.saveButton().click()
      await expect(authedPage.getByText('Alterações salvas.')).toBeVisible()

      // Back on the detail, the derived status flipped to operational.
      await pros.gotoById(proId)
      await expect(pros.operationalStatus()).toHaveText('Operacional')

      // And the pro now surfaces on the public agenda for that service.
      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByProfessional('Profissional 1').first()).toBeVisible()
    })
  },
)
