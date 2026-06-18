// Feature-level E2E — brief 0033 (ação destrutiva uniforme), reescopo v3.
//
// Asserts the REAL DOM state of each destructive scenario:
//   AC-03/05 — ONE "Excluir" verb + shared Radix AlertDialog (no "Arquivar",
//              no native confirm()).
//   AC-01    — master data: no active ref → hard-delete; active ref → soft-delete
//              (subscribers stay, "fim do ciclo" copy).
//   AC-07    — customer (operator): NOT LGPD. Active sub / future appointments do
//              NOT disable "Excluir" — the dialog lists what the cascade will
//              cancel and preserves the NAME in history. Only an OPEN comanda
//              blocks. No footprint → hard-delete.
//   AC-10    — safe confirm: the footer is inverted (prominent "Cancelar"); high
//              impact (customer/unit) requires typing the name to enable Excluir.
//   AC-11    — an archived/deleted category renders "Sem categoria", never the
//              raw id nor the internal "(arquivada)" state.

import { expect, test } from '../fixtures'
import { listItem, rowAction, rowActionsTrigger } from '../helpers/list'
import {
  seedCatalogItem,
  seedCategory,
  seedCustomer,
  seedOpenOrder,
  seedSubscription,
  seedSubscriptionPlan,
  seedUnit,
} from '../helpers/session'

test.describe('Ação destrutiva uniforme — brief 0033 (#1070)', { tag: '@critical' }, () => {
  // ── AC-03 / AC-05 — 1 verbo + AlertDialog ────────────────────────────────
  test('plans/catalog/units só expõem "Excluir" (sem "Arquivar")', async ({ org, authedPage }) => {
    const ts = Date.now()
    const planName = `Plano AC03 ${ts}`
    const itemName = `Item AC03 ${ts}`
    seedSubscriptionPlan(org.orgId, { name: planName })
    seedCatalogItem(org.orgId, {
      kind: 'product',
      name: itemName,
      commission: null,
      unitIds: org.unitIds,
    })

    // Target the ⋯ menu of a KNOWN row per surface — not `.first()`, which can
    // land on a row that renders no actions menu (e.g. an inline category row).
    // Each surface exposes one "Excluir" verb (menuitem) and never an "Arquivar".
    const surfaces: Array<{ path: string; row: RegExp }> = [
      { path: '/plans', row: new RegExp(planName) },
      { path: '/catalog', row: new RegExp(itemName) },
      { path: '/units', row: /Unidade 1/ },
    ]
    for (const { path, row } of surfaces) {
      await authedPage.goto(path)
      await rowActionsTrigger(listItem(authedPage, row)).click()
      await expect(authedPage.getByRole('menuitem', { name: 'Excluir' })).toBeVisible()
      await expect(authedPage.getByRole('menuitem', { name: 'Arquivar' })).toHaveCount(0)
      await authedPage.keyboard.press('Escape')
    }
  })

  // ── Cenário 1 — master data SEM ref → "Excluir" hard-deletes ─────────────
  test('cenário 1: master data sem referência → "Excluir" remove de vez', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    seedSubscriptionPlan(org.orgId, { name: `Plano Livre ${ts}` })

    await authedPage.goto('/plans')
    await rowAction(authedPage, new RegExp(`Plano Livre ${ts}`), 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // Inverted footer (AC-10): a prominent "Cancelar" is always present.
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible()
    await expect(dialog.getByText(/removido em definitivo/i)).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    await expect(listItem(authedPage, new RegExp(`Plano Livre ${ts}`))).toBeHidden({
      timeout: 5000,
    })
  })

  // ── Cenário 2 — master data COM ref ativa → "Excluir" soft-deletes ───────
  test('cenário 2: plano com assinante → "Excluir" soft-delete + cópia de fim de ciclo', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const planId = seedSubscriptionPlan(org.orgId, { name: `Plano Vínculo ${ts}` })
    const customerId = seedCustomer(org.orgId, { name: `Assinante ${ts}` })
    seedSubscription(org.orgId, customerId, { planId })

    await authedPage.goto('/plans')
    const row = listItem(authedPage, new RegExp(`Plano Vínculo ${ts}`))
    await expect(row).toBeVisible()

    await rowActionsTrigger(row).click()
    const excluir = authedPage.getByRole('menuitem', { name: 'Excluir' })
    await expect(excluir).toBeEnabled()
    await excluir.click()

    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // Bug 1 copy: cycle-end wording, new adesões blocked.
    await expect(dialog.getByText(/fim do ciclo vigente/i)).toBeVisible()
    await expect(dialog.getByText(/novas adesões ficam bloqueadas/i)).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    // Soft-delete: drops from the active list (snapshot keeps the subscriber).
    await expect(listItem(authedPage, new RegExp(`Plano Vínculo ${ts}`))).toBeHidden({
      timeout: 5000,
    })
  })

  // ── Bug 1 — plano descontinuado não lastreia nova adesão ─────────────────
  test('bug 1: plano arquivado não aparece no seletor de nova assinatura', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    seedCustomer(org.orgId, { name: `Cliente NA ${ts}` })
    seedSubscriptionPlan(org.orgId, { name: `Plano Vivo ${ts}` })
    seedSubscriptionPlan(org.orgId, {
      name: `Plano Morto ${ts}`,
      archivedAt: new Date().toISOString(),
    })

    await authedPage.goto('/subscriptions/new')
    // The plan picker is a design combobox; its options mount only when open.
    const planSelect = authedPage.getByRole('combobox', { name: 'Plano' })
    await expect(planSelect).toBeVisible()
    await planSelect.click()
    await expect(
      authedPage.getByRole('option', { name: new RegExp(`Plano Vivo ${ts}`) }),
    ).toHaveCount(1)
    await expect(
      authedPage.getByRole('option', { name: new RegExp(`Plano Morto ${ts}`) }),
    ).toHaveCount(0)
    await authedPage.keyboard.press('Escape')
  })

  // ── AC-11 — categoria arquivada/deletada NUNCA mostra id cru nem "(arquivada)"
  test('cenário 3: categoria arquivada → item mostra "Sem categoria" (sem id, sem "arquivada")', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const archivedCatId = seedCategory(org.orgId, {
      name: `Cabelo ${ts}`,
      archivedAt: new Date().toISOString(),
    })
    seedCatalogItem(org.orgId, {
      kind: 'service',
      name: `Corte Cat ${ts}`,
      categoryId: archivedCatId,
      commission: null,
      unitIds: org.unitIds,
    })

    await authedPage.goto('/catalog')
    const row = listItem(authedPage, new RegExp(`Corte Cat ${ts}`))
    await expect(row).toBeVisible()
    // Archived → resolves to "Sem categoria"; the internal state is never shown.
    await expect(row.getByText('Sem categoria')).toBeVisible()
    await expect(authedPage.getByText('(arquivada)', { exact: false })).toHaveCount(0)
    await expect(authedPage.getByText(archivedCatId, { exact: false })).toHaveCount(0)
  })

  test('cenário 3b: categoria deletada (FK órfã) → "Sem categoria", nunca id cru', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const orphanCatId = `e2e-cat-deleted-${ts}`
    seedCatalogItem(org.orgId, {
      kind: 'service',
      name: `Corte Órfão ${ts}`,
      categoryId: orphanCatId,
      commission: null,
      unitIds: org.unitIds,
    })

    await authedPage.goto('/catalog')
    const row = listItem(authedPage, new RegExp(`Corte Órfão ${ts}`))
    await expect(row).toBeVisible()
    await expect(row.getByText('Sem categoria')).toBeVisible()
    await expect(authedPage.getByText(orphanCatId, { exact: false })).toHaveCount(0)
  })

  test('cenário 3c: excluir categoria com itens → avisa a contagem; itens viram "Sem categoria"', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const catId = seedCategory(org.orgId, { name: `Cabelo ${ts}` })
    for (const n of [1, 2]) {
      seedCatalogItem(org.orgId, {
        kind: 'service',
        name: `Item Cat${n} ${ts}`,
        categoryId: catId,
        commission: null,
        unitIds: org.unitIds,
      })
    }

    await authedPage.goto('/catalog')
    // Inline category manager: the category lists its own "Excluir".
    const catRow = authedPage.getByRole('listitem').filter({ hasText: `Cabelo ${ts}` })
    await catRow.getByRole('button', { name: 'Excluir' }).click()

    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // Informed destruction (AC-10): the count is shown before confirming.
    await expect(dialog.getByText('Deixar 2 itens sem categoria')).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    // The items now resolve to "Sem categoria" (never the raw id / "(arquivada)").
    const itemRow = listItem(authedPage, new RegExp(`Item Cat1 ${ts}`))
    await expect(itemRow.getByText('Sem categoria')).toBeVisible({ timeout: 5000 })
  })

  // ── Cenário 4 — unidade arquivada some do seletor + não-operável ─────────
  test.describe('unidade arquivada', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('cenário 4: unidade arquivada some do seletor e não é selecionável', async ({
      org,
      authedPage,
    }) => {
      const ts = Date.now().toString()
      // Seed an archived unit (side effect only — asserted by its visible name,
      // no longer by id since the picker is queried by accessible name).
      seedUnit(org.orgId, {
        name: `Unidade Morta ${ts}`,
        archivedAt: new Date().toISOString(),
      })

      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/select-unit/)

      await expect(authedPage.getByRole('button', { name: 'Unidade 1', exact: true })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: 'Unidade 2', exact: true })).toBeVisible()
      await expect(authedPage.getByRole('button', { name: `Unidade Morta ${ts}` })).toHaveCount(0)
      await expect(authedPage.getByText(new RegExp(`Unidade Morta ${ts}`))).toHaveCount(0)

      await authedPage.getByRole('button', { name: 'Unidade 1', exact: true }).click()
      await expect(authedPage).toHaveURL(/\/agenda/)
      await authedPage.getByLabel('Contexto da unidade').click()
      await expect(authedPage.getByRole('menuitem', { name: 'Unidade 2' })).toBeVisible()
      await expect(authedPage.getByRole('menuitem', { name: `Unidade Morta ${ts}` })).toHaveCount(0)
    })
  })

  // ── Cenário 5 — customer com assinatura ativa → cascade + nome preservado ─
  test('cenário 5: cliente com assinatura → dialog lista o cancelamento, digita p/ confirmar, cascade + nome preservado', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const name = `Cliente Cascade ${ts}`
    const customerId = seedCustomer(org.orgId, { name })
    const planId = seedSubscriptionPlan(org.orgId, { name: `Plano Cli ${ts}` })
    seedSubscription(org.orgId, customerId, {
      planId,
      planName: `Plano Cli ${ts}`,
      status: 'active',
    })

    await authedPage.goto('/customers')
    const row = listItem(authedPage, new RegExp(name))
    await expect(row).toBeVisible()

    // NOT disabled (bug 4 reverted) — opens the dialog.
    await rowActionsTrigger(row).click()
    const trigger = authedPage.getByRole('menuitem', { name: 'Excluir' })
    await expect(trigger).toBeEnabled()
    await trigger.click()

    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // Loss-list: the cascade will cancel the active subscription.
    await expect(
      dialog.getByText(new RegExp(`Cancelar a assinatura Plano Cli ${ts}`)),
    ).toBeVisible()

    // Type-to-confirm gate (AC-10): destructive is disabled until the name matches.
    const confirm = dialog.getByRole('button', { name: 'Excluir' })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox').fill(name)
    await expect(confirm).toBeEnabled()
    await confirm.click()

    // Customer drops from the active list (soft-archived, deactivatedAt).
    await expect(listItem(authedPage, new RegExp(name))).toBeHidden({
      timeout: 5000,
    })

    // NAME preserved (operator delete ≠ LGPD anonymization → no neutral label):
    // the soft-archived customer still resolves its name on its detail page
    // (page loads → not hard-deleted; value is the name → not the neutral label).
    await authedPage.goto(`/customers/${customerId}`)
    await expect(authedPage.getByRole('textbox', { name: 'Nome' })).toHaveValue(name)

    // Cascade cancelled the active subscription.
    await authedPage.goto('/subscriptions?status=all')
    await expect(authedPage.getByText(new RegExp(name))).toBeVisible()
    await expect(authedPage.getByText('Cancelada', { exact: true })).toBeVisible()
  })

  // ── Cenário 5b — customer com comanda aberta → "Excluir" bloqueado no dialog
  test('cenário 5b: cliente com comanda aberta → dialog bloqueia até fechar', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const name = `Cliente Comanda ${ts}`
    const customerId = seedCustomer(org.orgId, { name })
    seedOpenOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId,
      attributedUserId: org.uid,
    })

    await authedPage.goto('/customers')
    await rowAction(authedPage, new RegExp(name), 'Excluir')

    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // Blocker surfaced; the destructive button stays disabled.
    await expect(dialog.getByText(/comanda.*aberta/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Excluir' })).toBeDisabled()
  })

  // ── Cenário 6 — customer SEM pegada → "Excluir" hard-deletes (digita p/ confirmar)
  test('cenário 6: cliente sem pegada → "Excluir" (digita nome) remove de vez', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const name = `Cliente Livre ${ts}`
    seedCustomer(org.orgId, { name })

    await authedPage.goto('/customers')
    await rowAction(authedPage, new RegExp(name), 'Excluir')

    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    const confirm = dialog.getByRole('button', { name: 'Excluir' })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox').fill(name)
    await confirm.click()

    await expect(listItem(authedPage, new RegExp(name))).toBeHidden({
      timeout: 5000,
    })
  })
})
