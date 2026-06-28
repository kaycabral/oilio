import { expect, test } from '../fixtures'
import { nextWeekday } from '../helpers/date'
import { linkMemberOperationToServices, seedService } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

// Issue #864 (finalize) — wizard confirm page detecta sessão e pré-preenche
// nome + WhatsApp do User doc. Anônimo continua funcionando como fallback
// (coberto pelos specs do wizard golden path).

test.describe('Auto-agendamento — pré-preenchimento por sessão (#864)', () => {
  test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

  test('visitante logado no wizard vê nome + WhatsApp pré-preenchidos', async ({
    org,
    authedPage,
  }) => {
    // `seedOrg` creates an owner User that has `displayName` "E2E Owner"
    // and `whatsapp` "5511900000000" + completionCompleted=true — perfect
    // surrogate for a "logged-in customer" visiting any org's wizard.
    const slug = orgSlug(org.orgId)
    const unitId = org.unitIds[0]!
    const serviceId = await seedService(org.orgId, {
      name: 'Corte Logado',
      publicVisible: true,
      unitIds: [unitId],
    })
    await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [serviceId])

    const targetDate = nextWeekday('Wed')
    const booking = new PublicBookingPage(authedPage, slug)
    await booking.gotoAvailability('unidade-1', { serviceId, from: targetDate })
    await booking
      .slotByMemberOperation(/profissional 1/i)
      .first()
      .click()
    await expect(authedPage.getByText(/Confirme os dados abaixo/i)).toBeVisible()
    await expect(authedPage.getByRole('textbox', { name: /seu nome/i })).toHaveValue('E2E Owner')
    await expect(authedPage.getByRole('textbox', { name: /whatsapp/i })).toHaveValue(
      '(11) 90000-0000',
    )
  })
})
