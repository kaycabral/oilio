import { expect, test } from '../fixtures'
import { enableUnitBusinessHours } from '../helpers/forms'
import { rowAction } from '../helpers/list'
import { enterUnitsAfterCreate, setActiveUnitCookie } from '../helpers/session'
import { UnitsPage } from '../pages'

// Coverage for #873 — Unit gained `slug` (canonical, unique within org)
// + Settings UI editable field. Wizard derives slug silently; Settings
// surfaces it and validates async against the active org's siblings.

test.describe('Unidades — slug público', () => {
  test.describe('CRUD com 1 unidade', () => {
    test.use({ orgInput: { unitCount: 1 } })

    test('slug da unidade cadastrada é editável na página de detalhe', async ({ authedPage }) => {
      // The migrated `UnitsList` (`@cbrl/design` List) shows name/address/hours
      // only — no Slug column. The slug lives on the unit's detail/edit page;
      // reach it via the row's ⋯ → Editar. seedOrg writes `unidade-1`.
      const units = new UnitsPage(authedPage)
      await units.gotoList()
      await rowAction(authedPage, /Unidade 1/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'Slug público' })).toHaveValue(
        'unidade-1',
      )
    })

    test('/units/new auto-deriva slug do nome e persiste', async ({ authedPage }) => {
      const units = new UnitsPage(authedPage)
      await units.gotoNew()
      // O diálogo de criação abre SOBRE /organizations (que já lista a unidade
      // seedada). Escopa todos os locators ao dialog — o hint de endereço
      // (/São Paulo\/SP/) e os labels do form aparecem no fundo E no dialog.
      const dialog = authedPage.getByRole('dialog')
      await dialog.getByRole('textbox', { name: 'Nome' }).fill('Filial Centro Velho')
      // Slug field auto-fills from name; should land available.
      await expect(dialog.getByRole('textbox', { name: 'Slug público' })).toHaveValue(
        'filial-centro-velho',
      )
      await expect(dialog.getByText(/disponível/i)).toBeVisible()

      await dialog.getByRole('textbox', { name: 'WhatsApp' }).fill('11955554444')
      await dialog.getByRole('textbox', { name: 'CEP' }).fill('01310-100')
      await expect(dialog.getByText(/São Paulo\/SP/)).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Número' }).fill('200')
      // v2: horário de funcionamento é obrigatório — habilita um dia.
      await enableUnitBusinessHours(dialog)
      await dialog.getByRole('button', { name: 'Criar' }).click()

      // Creating this 2nd unit crosses into multi-unit: the post-create redirect
      // lands on the `/select-unit` interstitial (brief 0029 AC-04). Pick a unit,
      // then verify the slug in the listing.
      await enterUnitsAfterCreate(authedPage)
      // The list shows the unit by name; the derived slug is asserted on the
      // detail/edit page (the List has no Slug column) — reached via ⋯ → Editar.
      await rowAction(authedPage, /Filial Centro Velho/, 'Editar')
      await expect(authedPage).toHaveURL(/\/units\/.+/)
      await expect(authedPage.getByRole('textbox', { name: 'Slug público' })).toHaveValue(
        'filial-centro-velho',
      )
    })
  })

  test.describe('CRUD com 2 unidades (colisão)', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('/units/[id] mostra erro de colisão quando slug é de outra unidade', async ({
      context,
      org,
      authedPage,
      baseURL,
    }) => {
      // Edit the first unit — try to steal the second unit's slug.
      const firstUnitId = org.unitIds[0]!
      // 2-unit org with no chosen unit is sent to `/select-unit` (0029
      // AC-04). Pin the active unit so the edit route resolves directly.
      await setActiveUnitCookie(context, firstUnitId, baseURL ?? undefined)
      const units = new UnitsPage(authedPage)
      await units.gotoById(firstUnitId)
      const slugInput = authedPage.getByRole('textbox', { name: 'Slug público' })
      await slugInput.fill('unidade-2')
      // Async probe should mark as taken.
      await expect(authedPage.getByText(/já em uso por outra unidade/i)).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Salvar' })).toBeDisabled()

      // Switching to a unique value clears the collision hint.
      // (Submit enable also depends on address validity, which the seeded unit
      // doesn't have — covering it here would test address fields, not slugs.)
      await slugInput.fill('unidade-renomeada')
      await expect(authedPage.getByText(/disponível/i)).toBeVisible()
      await expect(authedPage.getByText(/já em uso por outra unidade/i)).toHaveCount(0)
    })
  })
})
