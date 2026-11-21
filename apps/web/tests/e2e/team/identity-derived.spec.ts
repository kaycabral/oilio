// global `users/{userId}` doc — a reference, not a stored copy. The operational

import { patchUser } from '@/shared/db/pg/users-store'
import { formatBrazilPhone } from '@cbrl/br/phone'
import { expect, test } from '../fixtures'
import { uniqueWhatsapp } from '../helpers/session'
import { MemberOperationsPage } from '../pages'

function memberOperatorUserId(memberOperationId: string): string {
  return `e2e-prof-user-${memberOperationId}`
}

test.describe('Professionals — identidade derivada (#1046)', { tag: '@critical' }, () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test('o form de edição mostra nome/WhatsApp/email read-only (sem inputs)', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const wa = uniqueWhatsapp()
    await patchUser(memberOperatorUserId(proId), { mobile: wa }, new Date().toISOString())

    const pros = new MemberOperationsPage(authedPage)
    await pros.gotoById(proId)

    await expect(pros.identityName()).toHaveText('Profissional 1')
    await expect(pros.identityWhatsapp()).toHaveText(formatBrazilPhone(wa))
    await expect(pros.identityEmail()).toContainText('@e2e.local')

    await expect(authedPage.locator('input[name="name"]')).toHaveCount(0)
    await expect(authedPage.locator('input[name="mobile"]')).toHaveCount(0)
    await expect(authedPage.locator('input[name="email"]')).toHaveCount(0)
  })

  test('alterar User.whatsapp reflete no profissional sem reescrever a projeção', async ({
    org,
    authedPage,
  }) => {
    const proId = org.memberOperationIds[0]!
    const uid = memberOperatorUserId(proId)
    const pros = new MemberOperationsPage(authedPage)

    const initialWa = uniqueWhatsapp()
    await patchUser(uid, { mobile: initialWa }, new Date().toISOString())

    await pros.gotoById(proId)
    await expect(pros.identityWhatsapp()).toHaveText(formatBrazilPhone(initialWa))

    const nextWa = uniqueWhatsapp()
    await patchUser(uid, { mobile: nextWa }, new Date().toISOString())

    await pros.gotoById(proId)
    await expect(pros.identityWhatsapp()).toHaveText(formatBrazilPhone(nextWa))
  })
})
