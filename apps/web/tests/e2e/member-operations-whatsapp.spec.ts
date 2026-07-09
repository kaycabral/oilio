import { expect, test } from './fixtures'
import { MemberOperationsPage } from './pages'

test.describe('Profissionais — WhatsApp', () => {
  test.describe('detalhe do membro com pro cadastrado', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('detalhe do membro mostra o WhatsApp do profissional (read-only)', async ({
      org,
      authedPage,
    }) => {
      const memberOperations = new MemberOperationsPage(authedPage)
      await memberOperations.gotoById(org.memberOperationIds[0]!)
      await expect(memberOperations.identityWhatsapp()).toHaveText(/^\(\d{2}\) \d{5}-\d{4}$/)
    })
  })
})
