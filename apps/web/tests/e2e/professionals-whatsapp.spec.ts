import { expect, test } from './fixtures'
import { ProfessionalsPage } from './pages'

// Coverage for #826 — a Professional carries whatsapp, sourced live from the
// linked User (#1046). Since brief 0037 #1085 the `/professionals` listing is
// gone; the professional's WhatsApp now surfaces on the member detail
// (`/team/{userId}`) as read-only identity. Creation is invite-only (#1045).

test.describe('Profissionais — WhatsApp', () => {
  test.describe('detalhe do membro com pro cadastrado', () => {
    test.use({ tenantInput: { unitCount: 1, professionalCount: 1 } })

    test('detalhe do membro mostra o WhatsApp do profissional (read-only)', async ({
      tenant,
      authedPage,
    }) => {
      const professionals = new ProfessionalsPage(authedPage)
      await professionals.gotoById(tenant.professionalIds[0]!)
      await expect(professionals.identityWhatsapp()).toHaveText('(11) 90000-0000')
    })
  })
})
