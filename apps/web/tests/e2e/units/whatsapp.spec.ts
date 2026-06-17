import { expect, test } from '../fixtures'
import { rowAction } from '../helpers/list'
import { enterUnitsAfterCreate } from '../helpers/session'
import { UnitsPage } from '../pages'

// Coverage for #825 — Unit gained required whatsapp + optional email.
// The /units CRUD must capture + normalize WhatsApp via normalizeBrazilPhone,
// surface validation errors on invalid input, and show the stored value in
// listings.

test.describe('Unidades — WhatsApp', () => {
  test.describe('CRUD com 1 unidade', () => {
    test.use({ tenantInput: { unitCount: 1 } })

    test('WhatsApp cadastrado é editável na página de detalhe', async ({ authedPage }) => {
      // The migrated `UnitsList` (`@cbrl/design` List) shows name/address/hours
      // only — no WhatsApp column. The stored value lives on the unit's
      // detail/edit page; reach it via the row's ⋯ → Editar. The default seeder
      // writes whatsapp: '5511900000000', shown masked by the `PhoneInput`.
      const units = new UnitsPage(authedPage)
      await units.gotoList()
      await rowAction(authedPage, /Unidade 1/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'WhatsApp' })).toHaveValue(
        '(11) 90000-0000',
      )
    })

    test('/units/new persiste WhatsApp normalizado e aparece na listagem', async ({
      authedPage,
    }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoNew()
      await authedPage.getByRole('textbox', { name: 'Nome' }).fill('Filial Centro')
      await authedPage.getByRole('textbox', { name: 'WhatsApp' }).fill('11955554444')
      await authedPage.getByRole('textbox', { name: 'Email' }).fill('centro@e2e.test')
      await authedPage.getByRole('textbox', { name: 'CEP' }).fill('01310-100')
      // BrasilAPI lookup populates the rest of the address — wait for the
      // hint paragraph to appear so the auto-filled fields are present.
      await expect(authedPage.getByText(/São Paulo\/SP/)).toBeVisible()
      await authedPage.getByRole('textbox', { name: 'Número' }).fill('200')
      await authedPage.getByRole('button', { name: 'Criar' }).click()

      // Creating this 2nd unit crosses into multi-unit: the post-create redirect
      // lands on the `/select-unit` interstitial (brief 0029 AC-04). Pick a unit,
      // then verify the normalized WhatsApp in the listing.
      await enterUnitsAfterCreate(authedPage)
      // The list shows the unit by name; the normalized WhatsApp is asserted on
      // the detail/edit page (the List has no WhatsApp column) — via ⋯ → Editar.
      await rowAction(authedPage, /Filial Centro/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      // normalizeBrazilPhone prepends 55 for 11-digit BR numbers; the edit page's
      // `PhoneInput` shows the stored value masked for display.
      await expect(authedPage.getByRole('textbox', { name: 'WhatsApp' })).toHaveValue(
        '(11) 95555-4444',
      )
    })

    test('/units/new bloqueia o submit enquanto o WhatsApp não normaliza', async ({
      authedPage,
    }) => {
      // The migrated `UnitForm` gates "Criar" on client-side validity. The masked
      // `PhoneInput` strips non-digits, so junk like "abc" collapses to "" — and
      // since WhatsApp is required, the field stays empty and the submit button
      // stays disabled. The invalid value never reaches the server: the contract
      // moved from a server-side "WhatsApp inválido" error to a client-side gate.
      const units = new UnitsPage(authedPage)
      await units.gotoNew()
      await authedPage.getByRole('textbox', { name: 'Nome' }).fill('Filial Bad WA')
      const whatsapp = authedPage.getByRole('textbox', { name: 'WhatsApp' })
      await whatsapp.fill('abc')
      await authedPage.getByRole('textbox', { name: 'CEP' }).fill('01310-100')
      await expect(authedPage.getByText(/São Paulo\/SP/)).toBeVisible()
      await authedPage.getByRole('textbox', { name: 'Número' }).fill('200')

      // The mask rejected "abc" — the field is empty…
      await expect(whatsapp).toHaveValue('')
      // …so the required field is invalid and "Criar" stays disabled.
      await expect(authedPage.getByRole('button', { name: 'Criar' })).toBeDisabled()
      // No submission happened — still on /units/new.
      await expect(authedPage).toHaveURL(/\/units\/new$/)
    })
  })
})
