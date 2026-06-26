// Feature E2E for #1046 (brief 0028 AC-04/AC-05 · DoD Cenário 3; surface moved
// to the member detail by brief 0037 #1085): a
// Professional's personal identity (name/whatsapp/email) is read LIVE from the
// global `users/{userId}` doc — a reference, not a stored copy. The operational
// edit form renders these read-only (no inputs), and mutating the User's
// whatsapp reflects on the professional without any re-write of the projection.
//
// Runs against the emulator (no mocks). The fixture seeds one professional with
// a linked User doc (uid `e2e-prof-user-{pid}`, displayName "Profissional 1",
// whatsapp 5511900000000) — see helpers/session.ts.

import { patchUser } from '@/shared/db/pg/users-store'
import { expect, test } from '../fixtures'
import { ProfessionalsPage } from '../pages'

// The fixture derives each seeded pro's userId as `e2e-prof-user-${pid}`.
function professionalUserId(professionalId: string): string {
  return `e2e-prof-user-${professionalId}`
}

test.describe('Professionals — identidade derivada (#1046)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

  test('o form de edição mostra nome/WhatsApp/email read-only (sem inputs)', async ({
    org,
    authedPage,
  }) => {
    const pros = new ProfessionalsPage(authedPage)
    await pros.gotoById(org.professionalIds[0]!)

    // Identity renders as read-only text sourced from `users/{userId}`.
    await expect(pros.identityName()).toHaveText('Profissional 1')
    await expect(pros.identityWhatsapp()).toHaveText('(11) 90000-0000')
    await expect(pros.identityEmail()).toContainText('@e2e.local')

    // There are NO identity inputs in the operational form (AC-04). Tax
    // identity / commission / units / services stay editable, but personal
    // identity is reference-only.
    await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
    await expect(authedPage.locator('input[name="whatsapp"]')).toHaveCount(0)
    await expect(authedPage.locator('input[name="email"]')).toHaveCount(0)
  })

  test('alterar User.whatsapp reflete no profissional sem reescrever a projeção', async ({
    org,
    authedPage,
  }) => {
    const proId = org.professionalIds[0]!
    const uid = professionalUserId(proId)
    const pros = new ProfessionalsPage(authedPage)

    await pros.gotoById(proId)
    await expect(pros.identityWhatsapp()).toHaveText('(11) 90000-0000')

    // Mutate ONLY the global User row (`users.whatsapp`) — no touch to the
    // professional projection nor `professionals_pii`. The single-column patch
    // mirrors the old Firestore `updateMask.fieldPaths=whatsapp`.
    await patchUser(uid, { whatsapp: '5511955554444' }, new Date().toISOString())

    // Re-read the edit view: the new whatsapp surfaces live.
    await pros.gotoById(proId)
    await expect(pros.identityWhatsapp()).toHaveText('(11) 95555-4444')
  })
})
