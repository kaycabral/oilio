import { expect, test } from './fixtures'
import { setActiveUnitCookie } from './helpers/session'
import { tenantSlug } from './pages'

// Issue #864 — QR pra agenda + materialização atomic no booking commit.
//
// Validamos a primeira metade do AC (the QR target). A materialização
// atomic do Customer já roda dentro do `createWizardBooking` (#844) que
// reusa `upsertCustomerWithUser` + `commitAppointmentBooking` (#843) —
// coberta pelos specs do wizard e da integração de double-book.
//
// O QR deixou de viver em `/company` e passou a ser um artefato POR UNIDADE:
// renderiza na página de detalhe da unidade (`/units/{id}`), gated por
// `isUnitBookable` (hoursMode='appointment' E businessHours != null). O seed
// default monta unidades bookable, então o card aparece em cada unidade.

test.describe('Empresa — QR por unidade', () => {
  test.use({ tenantInput: { unitCount: 2, professionalCount: 1 } })

  test('QR por unidade aponta pra /{slug}/{unitSlug} na página da unidade', async ({
    context,
    tenant,
    authedPage,
    baseURL,
  }) => {
    const slug = tenantSlug(tenant.tenantId)

    // 2-unit tenant: pin an active unit so the /select-unit interstitial
    // (brief 0029) doesn't gate the unit pages. The QR card renders per unit.
    await setActiveUnitCookie(context, tenant.unitIds[0]!, baseURL ?? undefined)

    for (const [i, unitId] of tenant.unitIds.entries()) {
      const unitSlug = `unidade-${i + 1}`
      await authedPage.goto(`/units/${unitId}`)

      // CardTitle é um <div> (data-slot="dialog/card-title"), não role=heading.
      await expect(authedPage.getByText('QR pra agendamento')).toBeVisible()
      // O alvo do QR é a entrada de self-book da unidade: /{slug}/{unitSlug}.
      await expect(authedPage.getByText(new RegExp(`/${slug}/${unitSlug}`))).toBeVisible()
    }
  })
})
