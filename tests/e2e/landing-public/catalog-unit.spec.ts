import { expect, test } from '../fixtures'
import { linkMemberOperationToServices, seedService } from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

test.describe('Landing pública — catálogo por unidade', () => {
  test.describe('empresa com 1 unidade', () => {
    test.use({ orgInput: { unitCount: 1, memberOperationCount: 1 } })

    test('`/{orgSlug}` renderiza o catálogo da unidade inline', async ({ org, page }) => {
      await seedService(org.orgId, {
        name: 'Corte Single',
        durationMinutes: 30,
        priceCents: 6500,
        publicVisible: true,
        unitIds: [org.unitIds[0]!],
      })

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoCatalog()
      await expect(page.getByRole('heading', { name: /escolha uma unidade/i })).toHaveCount(0)
      await expect(booking.serviceCard('Corte Single')).toBeVisible()
      await expect(page.getByText(/R\$\s*65,00/)).toBeVisible()
    })
  })

  test.describe('empresa multi-unidade', () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('picker → catálogo da unidade → trocar unidade', async ({ org, page }) => {
      const unitA = org.unitIds[0]!
      const unitB = org.unitIds[1]!
      await seedService(org.orgId, {
        name: 'Corte Centro',
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitA],
      })
      await seedService(org.orgId, {
        name: 'Corte Filial',
        priceCents: 7500,
        publicVisible: true,
        unitIds: [unitB],
      })

      const slug = orgSlug(org.orgId)
      const booking = new PublicBookingPage(page, slug)

      await booking.gotoCatalog()
      await expect(page.getByRole('heading', { name: /escolha uma unidade/i })).toBeVisible()
      await expect(page.getByText('Unidade 1')).toBeVisible()
      await expect(page.getByText('Unidade 2')).toBeVisible()

      await page.getByRole('link', { name: /unidade 1/i }).click()
      await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1$`))
      await expect(page.getByText('Corte Centro')).toBeVisible()
      await expect(page.getByText('Corte Filial')).toHaveCount(0)

      await page.getByRole('link', { name: /trocar unidade/i }).click()
      await expect(page).toHaveURL(new RegExp(`/${slug}$`))
      await expect(page.getByRole('heading', { name: /escolha uma unidade/i })).toBeVisible()
    })
  })

  test.describe("price visibility 'on_request'", () => {
    test.use({ orgInput: { unitCount: 1 } })

    test("renderiza 'Sob consulta' e nunca expõe o preço", async ({ org, page }) => {
      await seedService(org.orgId, {
        name: 'Premium Negociado',
        priceCents: 99999,
        publicVisible: true,
        priceVisibility: 'on_request',
        unitIds: [org.unitIds[0]!],
      })

      const booking = new PublicBookingPage(page, orgSlug(org.orgId))
      await booking.gotoCatalog()
      await expect(booking.serviceCard('Premium Negociado')).toBeVisible()
      await expect(page.getByText(/sob consulta/i)).toBeVisible()
      await expect(page.getByText(/R\$\s*999,99/)).toHaveCount(0)
    })
  })

  test.describe('filtro por profissional', () => {
    test.use({ orgInput: { unitCount: 2, memberOperationCount: 1 } })

    test('?memberOperation={id} filtra catálogo aos serviços que o pro executa', async ({
      org,
      page,
    }) => {
      const unitA = org.unitIds[0]!
      const slug = orgSlug(org.orgId)

      const svcA = await seedService(org.orgId, {
        name: 'Corte Pro-A',
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitA],
      })
      await seedService(org.orgId, {
        name: 'Corte Pro-Outro',
        priceCents: 6000,
        publicVisible: true,
        unitIds: [unitA],
      })

      await linkMemberOperationToServices(org.orgId, org.memberOperationIds[0]!, [svcA])

      await page.goto(`/${slug}/unidade-1?memberOperation=${org.memberOperationIds[0]}`)
      await expect(page.getByText(/filtrado por profissional/i)).toBeVisible()
      await expect(page.getByText('Corte Pro-A')).toBeVisible()
      await expect(page.getByText('Corte Pro-Outro')).toHaveCount(0)

      await page.getByRole('link', { name: /limpar filtro/i }).click()
      await expect(page).toHaveURL(new RegExp(`/${slug}/unidade-1$`))
      await expect(page.getByText('Corte Pro-A')).toBeVisible()
      await expect(page.getByText('Corte Pro-Outro')).toBeVisible()
    })
  })
})
