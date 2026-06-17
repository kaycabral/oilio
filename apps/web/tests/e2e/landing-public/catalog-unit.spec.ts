import { expect, test } from '../fixtures'
import { linkProfessionalToServices, seedService } from '../helpers/session'
import { PublicBookingPage, tenantSlug } from '../pages'

// Issue #841 — Catálogo público de serviços da unit (capability D / V0.1).
//
// Covers:
//   - Single-unit tenant: `/{tenantSlug}` short-circuits to the unit catalog.
//   - Multi-unit tenant: `/{tenantSlug}` renders the picker;
//     `/{tenantSlug}/{unitSlug}` renders the unit-scoped catalog.
//   - `priceVisibility='on_request'` renders "Sob consulta".
//   - `?professional={id}` filters the catalog to services the pro executes.

test.describe('Landing pública — catálogo por unidade', () => {
  test.describe('empresa com 1 unidade', () => {
    test.use({ tenantInput: { unitCount: 1, professionalCount: 1 } })

    test('`/{tenantSlug}` renderiza o catálogo da unidade inline', async ({ tenant, page }) => {
      seedService(tenant.tenantId, {
        name: 'Corte Single',
        durationMinutes: 30,
        priceCents: 6500,
        publicVisible: true,
        unitIds: [tenant.unitIds[0]!],
      })

      const booking = new PublicBookingPage(page, tenantSlug(tenant.tenantId))
      await booking.gotoCatalog()
      // No picker — the catalog renders inline.
      await expect(page.getByRole('heading', { name: /escolha uma unidade/i })).toHaveCount(0)
      await expect(booking.serviceCard('Corte Single')).toBeVisible()
      await expect(page.getByText(/R\$\s*65,00/)).toBeVisible()
    })
  })

  test.describe('empresa multi-unidade', () => {
    test.use({ tenantInput: { unitCount: 2, professionalCount: 1 } })

    test('picker → catálogo da unidade → trocar unidade', async ({ tenant, page }) => {
      // Different services per unit so the unit-scoped catalog is observable.
      const unitA = tenant.unitIds[0]!
      const unitB = tenant.unitIds[1]!
      seedService(tenant.tenantId, {
        name: 'Corte Centro',
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitA],
      })
      seedService(tenant.tenantId, {
        name: 'Corte Filial',
        priceCents: 7500,
        publicVisible: true,
        unitIds: [unitB],
      })

      const slug = tenantSlug(tenant.tenantId)
      const booking = new PublicBookingPage(page, slug)

      // `/{tenantSlug}` shows the picker — both unit names visible.
      await booking.gotoCatalog()
      await expect(page.getByRole('heading', { name: /escolha uma unidade/i })).toBeVisible()
      await expect(page.getByText('Unidade 1')).toBeVisible()
      await expect(page.getByText('Unidade 2')).toBeVisible()

      // Pick first unit → unit-scoped catalog shows only its service.
      await page.getByRole('link', { name: /unidade 1/i }).click()
      await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1$`))
      await expect(page.getByText('Corte Centro')).toBeVisible()
      await expect(page.getByText('Corte Filial')).toHaveCount(0)

      // "Trocar unidade" hops back to the picker.
      await page.getByRole('link', { name: /trocar unidade/i }).click()
      await expect(page).toHaveURL(new RegExp(`/${slug}$`))
      await expect(page.getByRole('heading', { name: /escolha uma unidade/i })).toBeVisible()
    })
  })

  test.describe("price visibility 'on_request'", () => {
    test.use({ tenantInput: { unitCount: 1 } })

    test("renderiza 'Sob consulta' e nunca expõe o preço", async ({ tenant, page }) => {
      seedService(tenant.tenantId, {
        name: 'Premium Negociado',
        priceCents: 99999,
        publicVisible: true,
        priceVisibility: 'on_request',
        unitIds: [tenant.unitIds[0]!],
      })

      const booking = new PublicBookingPage(page, tenantSlug(tenant.tenantId))
      await booking.gotoCatalog()
      await expect(booking.serviceCard('Premium Negociado')).toBeVisible()
      await expect(page.getByText(/sob consulta/i)).toBeVisible()
      // Specific value never leaks to the wire.
      await expect(page.getByText(/R\$\s*999,99/)).toHaveCount(0)
    })
  })

  test.describe('filtro por profissional', () => {
    test.use({ tenantInput: { unitCount: 2, professionalCount: 1 } })

    test('?professional={id} filtra catálogo aos serviços que o pro executa', async ({
      tenant,
      page,
    }) => {
      const unitA = tenant.unitIds[0]!
      const slug = tenantSlug(tenant.tenantId)

      const svcA = seedService(tenant.tenantId, {
        name: 'Corte Pro-A',
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitA],
      })
      seedService(tenant.tenantId, {
        name: 'Corte Pro-Outro',
        priceCents: 6000,
        publicVisible: true,
        unitIds: [unitA],
      })

      // The pro executes only svcA at unit A.
      linkProfessionalToServices(tenant.tenantId, tenant.professionalIds[0]!, [svcA])

      await page.goto(`/${slug}/unidade-1?professional=${tenant.professionalIds[0]}`)
      await expect(page.getByText(/filtrado por profissional/i)).toBeVisible()
      await expect(page.getByText('Corte Pro-A')).toBeVisible()
      await expect(page.getByText('Corte Pro-Outro')).toHaveCount(0)

      // Clear filter → both visible.
      await page.getByRole('link', { name: /limpar filtro/i }).click()
      await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1$`))
      await expect(page.getByText('Corte Pro-A')).toBeVisible()
      await expect(page.getByText('Corte Pro-Outro')).toBeVisible()
    })
  })
})
