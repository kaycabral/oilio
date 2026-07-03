// Feature E2E for #1046 (brief 0028 AC-04/AC-05 · DoD Cenário 3; surface moved
// to the member detail by brief 0037 #1085): a
// MemberOperation's personal identity (name/whatsapp/email) is read LIVE from the
// global `users/{userId}` doc — a reference, not a stored copy. The operational
// edit form renders these read-only (no inputs), and mutating the User's
// whatsapp reflects on the memberOperation without any re-write of the projection.
//
// Runs against the emulator (no mocks). The fixture seeds one memberOperation with
// a linked User doc (uid `e2e-prof-user-{pid}`, displayName "Profissional 1",
// whatsapp 5511900000000) — see helpers/session.ts.

import { formatBrazilPhone } from '@/domain/utils/phone'
import { patchUser } from '@/shared/db/pg/users-store'
import { expect, test } from '../fixtures'
import { uniqueWhatsapp } from '../helpers/session'
import { MemberOperationsPage } from '../pages'

// The fixture derives each seeded pro's userId as `e2e-prof-user-${pid}`.
function memberOperatorUserId(memberOperationId: string): string {
  return `e2e-prof-user-${memberOperationId}`
}

test.describe('Professionals — identidade derivada (#1046)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test('o form de edição mostra nome/WhatsApp/email read-only (sem inputs)', async ({
    org,
    authedPage,
  }) => {
    // Pin the seeded pro's whatsapp to a known unique value so the read-only
    // display can be asserted against a deterministic mask (the helper seeds a
    // per-run unique number we can't hardcode).
    const proId = org.memberOperationIds[0]!
    const wa = uniqueWhatsapp()
    await patchUser(memberOperatorUserId(proId), { whatsapp: wa }, new Date().toISOString())

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoById(proId)

    // Identity renders as read-only text sourced from `users/{userId}`.
    await expect(pros.identityName()).toHaveText('Profissional 1')
    await expect(pros.identityWhatsapp()).toHaveText(formatBrazilPhone(wa))
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
    const proId = org.memberOperationIds[0]!
    const uid = memberOperatorUserId(proId)
    const pros = new MemberOperationsPage(authedPage)

    // Pin a known starting whatsapp (helper seeds a per-run unique number).
    const initialWa = uniqueWhatsapp()
    await patchUser(uid, { whatsapp: initialWa }, new Date().toISOString())

    await pros.gotoById(proId)
    await expect(pros.identityWhatsapp()).toHaveText(formatBrazilPhone(initialWa))

    // Mutate ONLY the global User row (`users.whatsapp`) — no touch to the
    // memberOperation projection nor `member_operations_pii`. The single-column patch
    // mirrors the old Firestore `updateMask.fieldPaths=whatsapp`.
    const nextWa = uniqueWhatsapp()
    await patchUser(uid, { whatsapp: nextWa }, new Date().toISOString())

    // Re-read the edit view: the new whatsapp surfaces live.
    await pros.gotoById(proId)
    await expect(pros.identityWhatsapp()).toHaveText(formatBrazilPhone(nextWa))
  })
})
