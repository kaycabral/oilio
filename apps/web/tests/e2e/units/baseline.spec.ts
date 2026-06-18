// Baseline E2E (princípio #17 / lyra _shared/min-test-coverage.md).
// CRUD de unidade: render+empty · criar pelo fluxo real→listar→editar→excluir ·
// dado degenerado (unidade legada sem id/slug/whatsapp).
//
// O slug é derivado do nome (slugifyUnitName) + checagem async de unicidade —
// por isso o create usa um NOME único e deixa o slug auto-derivar, evitando a
// corrida do slugTouched que mantinha o botão "Criar" desabilitado.

import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { enableUnitBusinessHours } from '../helpers/forms'
import { fillStable } from '../helpers/hydration'
import { listItem, rowAction } from '../helpers/list'
import { enterUnitsAfterCreate, seedUnit } from '../helpers/session'

// Seeding/creating a 2nd unit crosses the org into multi-unit: with no
// chosen unit the next `(app)` navigation hits the `/select-unit` interstitial
// (brief 0029 AC-04). Dismiss it by picking a unit, then land on `/units`.
async function dismissUnitInterstitialIfPresent(page: Page): Promise<void> {
  await enterUnitsAfterCreate(page)
}

test.describe('Units — baseline (#17)', () => {
  // PRD Identidade v2 / brief 0046 + F5: there is no first-unit gate and the
  // standalone `/units` list was folded into `/organizations` (Negócios &
  // Unidades). A 0-unit owner hitting `/units` is forwarded to `/organizations`,
  // which renders the unit empty-state inline.
  test.describe('empty org', () => {
    test.use({ orgInput: { unitCount: 0 } })

    test('render + empty state (/units → /organizations)', async ({ authedPage }) => {
      await authedPage.goto('/units')
      await expect(authedPage).toHaveURL(/\/organizations(\/|\?|$)/)
      await expect(
        authedPage.getByText('Nenhuma unidade ainda. Crie a primeira para começar a atender.'),
      ).toBeVisible()
    })
  })

  test('criar pelo fluxo real → listar → editar → excluir', async ({ authedPage }) => {
    // Stub do CEP lookup (brasilapi externo) → determinístico, sem rede. O fluxo
    // do form continua real: a UI faz o fetch, popula os hidden inputs de
    // endereço e revela o campo "número".
    await authedPage.route('**/api/postal-code/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          postalCode: '01310100',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Bela Vista',
          street: 'Avenida Paulista',
        }),
      }),
    )
    const ts = Date.now().toString()
    const name = `Unidade Baseline ${ts}`
    const edited = `${name} Editada`

    // Criar — preenche o slug PRIMEIRO (seta slugTouched + dispara o input event
    // que o useFormValidity escuta); assim o effect de auto-derivar-do-nome não
    // sobrescreve, e a validade do form recalcula com todos os campos presentes.
    await authedPage.goto('/units/new')
    await fillStable(authedPage.locator('input[name="slug"]'), `un-${ts.slice(-9)}`)
    await authedPage.locator('input[name="name"]').fill(name)
    await authedPage.locator('input[name="whatsapp"]').fill(`11${ts.slice(-9)}`)
    await authedPage.locator('input[name="postalCode"]').fill('01310100')
    // Lookup popula o endereço e revela o campo número (required).
    await authedPage.locator('input[name="number"]').fill('123')
    // v2: horário de funcionamento é obrigatório — habilita um dia (form vem
    // com todos os dias OFF) pra liberar o submit.
    await enableUnitBusinessHours(authedPage)
    await authedPage.getByRole('button', { name: 'Criar' }).click()
    // Creating this 2nd unit (the seed already has one) crosses into multi-unit:
    // the post-create redirect hits the `/select-unit` interstitial — pick a
    // unit, then go back to the listing to verify the unit was created.
    await dismissUnitInterstitialIfPresent(authedPage)
    await expect(authedPage).toHaveURL(/\/units$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    // Editar
    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(authedPage).toHaveURL(/\/units\/.+/)
    await authedPage.locator('input[name="name"]').fill(edited)
    await authedPage.getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/units$/)
    await expect(authedPage.getByText(edited, { exact: true })).toBeVisible({ timeout: 5000 })

    // Excluir — shared AlertDialog (brief 0033, AC-05/AC-10): unit is high impact,
    // so type the name to confirm before the destructive button enables.
    await rowAction(authedPage, new RegExp(ts), 'Excluir')
    const delDialog = authedPage.getByRole('alertdialog')
    await delDialog.getByRole('textbox').fill(edited)
    await delDialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, new RegExp(ts))).toBeHidden({
      timeout: 5000,
    })
  })

  test('unidade mínima (sem endereço/horário configurados) renderiza e exclui', async ({
    org,
    authedPage,
  }) => {
    // An under-configured but schema-valid 2nd unit (address/businessHours null,
    // as a just-created unit looks). Reads strictly via StoredUnit — a unit
    // without id/slug can't exist (createUnit always sets them).
    seedUnit(org.orgId, { name: 'Unidade Legada' })

    // The seed makes this a 2-unit org → first `(app)` nav hits the
    // `/select-unit` interstitial (0029 AC-04). Dismiss it, then list units.
    await authedPage.goto('/units')
    await dismissUnitInterstitialIfPresent(authedPage)
    await expect(authedPage.getByRole('heading', { name: 'Unidades' })).toBeVisible()
    await expect(authedPage.getByText('Unidade Legada')).toBeVisible()

    await rowAction(authedPage, /Unidade Legada/, 'Excluir')
    const legadaDialog = authedPage.getByRole('alertdialog')
    await legadaDialog.getByRole('textbox').fill('Unidade Legada')
    await legadaDialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /Unidade Legada/)).toBeHidden({
      timeout: 5000,
    })
  })

  // One verb "Excluir" (brief 0033, AC-03 — #1070). The UI shows only "Excluir"
  // (no separate "Arquivar"). A unit an active professional references (the seed
  // links the default professional to "Unidade 1") soft-deletes via the single
  // "Excluir": drops from the active list while history is preserved. The dialog
  // warns up front.
  test('em uso: 1 verbo "Excluir" vira soft-delete (some da ativa)', async ({ authedPage }) => {
    await authedPage.goto('/units')
    await expect(listItem(authedPage, /Unidade 1/)).toBeVisible()
    // No "Arquivar" verb anywhere (AC-03).
    await expect(authedPage.getByRole('button', { name: 'Arquivar' })).toHaveCount(0)
    await expect(authedPage.getByRole('menuitem', { name: 'Arquivar' })).toHaveCount(0)

    await rowAction(authedPage, /Unidade 1/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/profissional ativo ou agendamento futuro/i)).toBeVisible()
    await dialog.getByRole('textbox').fill('Unidade 1')
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    // Soft-deleted: drops out of the active list.
    await expect(listItem(authedPage, /Unidade 1/)).toBeHidden({ timeout: 5000 })
  })

  // Counterpart: a free unit (no references) hard-deletes cleanly via the same
  // single "Excluir" verb.
  test('livre: "Excluir" hard-delete remove de vez (sem referências)', async ({ authedPage }) => {
    await authedPage.route('**/api/postal-code/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          postalCode: '01310100',
          state: 'SP',
          city: 'São Paulo',
          neighborhood: 'Bela Vista',
          street: 'Avenida Paulista',
        }),
      }),
    )
    const ts = Date.now().toString()
    const name = `Unidade Livre ${ts}`
    await authedPage.goto('/units/new')
    await fillStable(authedPage.locator('input[name="slug"]'), `liv-${ts.slice(-9)}`)
    await authedPage.locator('input[name="name"]').fill(name)
    await authedPage.locator('input[name="whatsapp"]').fill(`11${ts.slice(-9)}`)
    await authedPage.locator('input[name="postalCode"]').fill('01310100')
    await authedPage.locator('input[name="number"]').fill('123')
    // v2: habilita um dia de horário (obrigatório) pra liberar o submit.
    await enableUnitBusinessHours(authedPage)
    await authedPage.getByRole('button', { name: 'Criar' }).click()
    // 2nd unit → post-create `/select-unit` interstitial; dismiss + relist.
    await dismissUnitInterstitialIfPresent(authedPage)
    await expect(authedPage).toHaveURL(/\/units$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Excluir')
    const livreDialog = authedPage.getByRole('alertdialog')
    await livreDialog.getByRole('textbox').fill(name)
    await livreDialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, new RegExp(ts))).toBeHidden({
      timeout: 5000,
    })
  })
})
