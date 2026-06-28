import { expect, test } from './fixtures'
import { MemberOperationsPage } from './pages'

// Coverage for #826 — a MemberOperation carries whatsapp, sourced live from the
// linked User (#1046). Since brief 0037 #1085 the `/memberOperations` listing is
// gone; the memberOperation's WhatsApp now surfaces on the member detail
// (`/team/{userId}`) as read-only identity. Creation is invite-only (#1045).

test.describe('Profissionais — WhatsApp', () => {
  test.describe('detalhe do membro com pro cadastrado', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('detalhe do membro mostra o WhatsApp do profissional (read-only)', async ({
      org,
      authedPage,
    }) => {
      const memberOperations = new MemberOperationsPage(authedPage)
      await memberOperations.gotoById(org.memberOperationIds[0]!)
      await expect(memberOperations.identityWhatsapp()).toHaveText('(11) 90000-0000')
    })
  })
})
