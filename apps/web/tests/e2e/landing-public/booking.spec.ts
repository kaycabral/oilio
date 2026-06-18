import { execFileSync } from 'node:child_process'
import { expect, test } from '../fixtures'
import { FIRESTORE_HOST, PROJECT_ID } from '../helpers/emulator'
import { seedService } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

// Épico #672 — Landing pública por estabelecimento.
// - #673 slug público resolve para uma página servida sem auth.
// - #674 branding (logo/banner/descrição) aparece quando configurado.
// - #675 catálogo público filtra `publicVisible && active`.
// - #676 booking público cria customer + appointment.

// Branding patch isn't covered by `helpers/session.ts` (one-off shape).
// Keep this here until a second spec needs it.
function patchOrgBranding(
  orgId: string,
  branding: { logoUrl?: string; bannerUrl?: string; description?: string },
) {
  const fields: Record<string, { stringValue: string }> = {}
  if (branding.logoUrl) fields.logoUrl = { stringValue: branding.logoUrl }
  if (branding.bannerUrl) fields.bannerUrl = { stringValue: branding.bannerUrl }
  if (branding.description) fields.description = { stringValue: branding.description }
  const body = JSON.stringify({ fields: { branding: { mapValue: { fields } } } })
  execFileSync(
    'curl',
    [
      '-fsS',
      '-X',
      'PATCH',
      `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/orgs/${orgId}?updateMask.fieldPaths=branding`,
      '-H',
      'Authorization: Bearer owner',
      '-H',
      'Content-Type: application/json',
      '-d',
      body,
    ],
    { encoding: 'utf8' },
  )
}

test.describe('Landing pública — branding + catálogo + agendamento', () => {
  test.describe('empresa com unidade + profissional', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 1 } })

    test(
      'renderiza branding + catálogo público e completa booking',
      { tag: '@critical' },
      async ({ org, page }) => {
        const slug = orgSlug(org.orgId)

        patchOrgBranding(org.orgId, {
          logoUrl: 'https://example.com/logo.png',
          bannerUrl: 'https://example.com/banner.png',
          description: 'Test studio descrição pública.',
        })

        // Serviço visível no catálogo público.
        seedService(org.orgId, {
          name: 'Corte Premium',
          durationMinutes: 30,
          priceCents: 6500,
          publicVisible: true,
          unitIds: org.unitIds,
        })
        // Serviço NÃO público — não deve aparecer no catálogo.
        seedService(org.orgId, {
          name: 'Serviço Interno',
          durationMinutes: 30,
          priceCents: 4500,
          publicVisible: false,
          unitIds: org.unitIds,
        })

        const booking = new PublicBookingPage(page, slug)

        // Página pública (sem auth).
        await booking.gotoCatalog()
        await expect(booking.orgHeading()).toBeVisible()
        await expect(page.getByText('Test studio descrição pública.')).toBeVisible()
        await expect(booking.serviceCard('Corte Premium')).toBeVisible()
        await expect(page.getByText(/R\$\s*65,00/)).toBeVisible()
        // Service NÃO público fica escondido.
        await expect(page.getByText('Serviço Interno')).toHaveCount(0)

        // Legacy single-step form still works (covered separately from the
        // #844 wizard) — navigate directly to the legacy URL.
        await booking.gotoBookLegacy()
        await expect(booking.legacyHeading()).toBeVisible()

        // Escolhe um horário 3 dias no futuro às 14h pra evitar conflict com testes
        // próximos e ficar bem após `Date.now()`.
        const future = new Date(Date.now() + 3 * 24 * 60 * 60_000)
        const yyyy = future.getUTCFullYear()
        const mm = String(future.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(future.getUTCDate()).padStart(2, '0')
        await booking.fillLegacyForm({
          dateTimeIso: `${yyyy}-${mm}-${dd}T14:00`,
          name: 'Joana Cliente',
          whatsapp: `119${Math.floor(10000000 + Math.random() * 89999999)}`,
        })
        await booking.legacySubmit().click()
        await expect(booking.legacySuccessHeading()).toBeVisible()
      },
    )
  })

  test('slug inexistente retorna 404', async ({ page }) => {
    const res = await page.goto('/nao-existe-este-org-xyz-123')
    expect(res?.status()).toBe(404)
  })
})
