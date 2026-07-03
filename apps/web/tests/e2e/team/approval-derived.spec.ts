// Feature E2E for #1047 (brief 0028 AC-06/AC-07; surface moved to the member
// detail by brief 0037 #1085)
// (AC-06/AC-07 · DoD Cenário 2): a
// MemberOperation's `operationalStatus` is DERIVED from real facts — never written
// by a UI input. A pro without WhatsApp/service stays `incomplete` and is NOT on
// the public agenda; completing the profile flips it to `operational`
// automatically (via the `member_operation.activated` domain event); there is NO UI
// path to write the status.
//
// Runs against the emulator (no mocks). The fixture seeds the pro `incomplete`
// with an empty catalogServiceIds list; the linked User carries a whatsapp (read live,
// #1046) which we null out / restore via a direct Postgres patch (post-cutover).

import { patchUser } from '@/shared/db/pg/users-store'
import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { seedService, uniqueWhatsapp } from '../helpers/session'
import { MemberOperationsPage, PublicBookingPage, orgSlug } from '../pages'

function memberOperatorUserId(memberOperationId: string): string {
  return `e2e-prof-user-${memberOperationId}`
}

// The `User` union forbids a COMPLETED account with a null whatsapp, so nulling
// whatsapp must also flip `completionCompleted` back to false (a legal
// `UserIncomplete`); restoring a whatsapp re-completes the account. Without this
// the row fails every union branch and the strict-decoding read crashes the page.
// Post-cutover this is a merge-style column patch on the global `users` row
// (`patchUser` keys are snake_case columns), mirroring the old updateMask PATCH:
// only `mobile` + `completion_completed` change, every other field stays.
async function patchUserMobile(uid: string, mobile: string | null): Promise<void> {
  await patchUser(uid, { mobile, completion_completed: mobile !== null }, new Date().toISOString())
}

test.describe(
  'Professionals — status operacional derivado por evento (#1047)',
  { tag: '@critical' },
  () => {
    test.use({
      orgInput: {
        unitCount: 1,
        memberOperationCount: 1,
        memberOperationOperationalStatus: 'incomplete',
      },
    })

    test('não há input de status — o status é texto read-only derivado', async ({
      org,
      authedPage,
    }) => {
      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoById(org.memberOperationIds[0]!)

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
      const proId = org.memberOperationIds[0]!
      const unitId = org.unitIds[0]!

      // Strip the linked User's WhatsApp — profile is now incomplete on two
      // axes (no whatsapp, no service).
      await patchUserMobile(memberOperatorUserId(proId), null)

      // A public service exists in the unit, but the pro executes none of it
      // (catalogServiceIds empty) — so they're off the public agenda regardless.
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      const pros = new MemberOperationsPage(authedPage)
      await pros.gotoById(proId)
      await expect(pros.operationalStatus()).toHaveText('Cadastro incompleto')

      // Public availability for that service has no memberOperation available
      // (the pro executes no service → off the agenda).
      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoAvailability('unidade-1', { serviceId, from: nextWeekday('Wed') })
      await expect(booking.slotByMemberOperation('Profissional 1')).toHaveCount(0)
    })

    test('completar o perfil (unidade + serviço + WhatsApp) vira operacional sozinho', async ({
      org,
      authedPage,
      page,
    }) => {
      const proId = org.memberOperationIds[0]!
      const unitId = org.unitIds[0]!

      // Ensure WhatsApp present on the linked User so the ONLY missing operational
      // axis is the service the UI adds below (unit is already linked by the seed).
      // Patch ONLY whatsapp — keep `completion_completed: false` so the row stays
      // a valid `UserIncomplete` (the COMPLETED union branch also requires a
      // non-null birthDate, which the fixture omits; flipping completion without
      // it makes the row match no branch and the strict-decoded read 500s). The
      // derive keys on whatsapp presence, not on `completionCompleted`.
      await patchUser(
        memberOperatorUserId(proId),
        { mobile: uniqueWhatsapp() },
        new Date().toISOString(),
      )

      // Seed a service in the pro's unit and attach it through the operational
      // form — that mutation re-derives the status and emits
      // `member_operation.activated` (no manual status write anywhere).
      const serviceId = await seedService(org.orgId, {
        name: 'Corte',
        durationMinutes: 30,
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })

      const pros = new MemberOperationsPage(authedPage)
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
      await expect(booking.slotByMemberOperation('Profissional 1').first()).toBeVisible()
    })
  },
)
