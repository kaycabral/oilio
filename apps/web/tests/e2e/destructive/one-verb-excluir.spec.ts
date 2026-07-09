import { expect, test } from '../fixtures'
import { listItem, rowAction, rowActionsTrigger } from '../helpers/list'
import {
  deleteCategory,
  seedCatalogItem,
  seedCategory,
  seedCustomer,
  seedOpenOrder,
  seedSubscription,
  seedSubscriptionPlan,
  seedUnit,
} from '../helpers/session'

test.describe('Ação destrutiva uniforme — brief 0033 (#1070)', { tag: '@critical' }, () => {
  test('plans/catalog/units só expõem "Excluir" (sem "Arquivar")', async ({ org, authedPage }) => {
    const ts = Date.now()
    const planName = `Plano AC03 ${ts}`
    const itemName = `Item AC03 ${ts}`
    await seedSubscriptionPlan(org.orgId, { name: planName })
    await seedCatalogItem(org.orgId, {
      kind: 'product',
      name: itemName,
      commission: null,
      unitIds: org.unitIds,
    })

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

  test('cenário 1: master data sem referência → "Excluir" remove de vez', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    await seedSubscriptionPlan(org.orgId, { name: `Plano Livre ${ts}` })

    await authedPage.goto('/plans')
    await rowAction(authedPage, new RegExp(`Plano Livre ${ts}`), 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible()
    await expect(dialog.getByText(/removido em definitivo/i)).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    await expect(listItem(authedPage, new RegExp(`Plano Livre ${ts}`))).toBeHidden({
      timeout: 5000,
    })
  })

  test('cenário 2: plano com assinante → "Excluir" soft-delete + cópia de fim de ciclo', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const planId = await seedSubscriptionPlan(org.orgId, { name: `Plano Vínculo ${ts}` })
    const customerId = await seedCustomer(org.orgId, { name: `Assinante ${ts}` })
    await seedSubscription(org.orgId, customerId, { planId })

    await authedPage.goto('/plans')
    const row = listItem(authedPage, new RegExp(`Plano Vínculo ${ts}`))
    await expect(row).toBeVisible()

    await rowActionsTrigger(row).click()
    const excluir = authedPage.getByRole('menuitem', { name: 'Excluir' })
    await expect(excluir).toBeEnabled()
    await excluir.click()

    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/fim do ciclo vigente/i)).toBeVisible()
    await expect(dialog.getByText(/novas adesões ficam bloqueadas/i)).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    await expect(listItem(authedPage, new RegExp(`Plano Vínculo ${ts}`))).toBeHidden({
      timeout: 5000,
    })
  })

  test('bug 1: plano arquivado não aparece no seletor de nova assinatura', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    await seedCustomer(org.orgId, { name: `Cliente NA ${ts}` })
    await seedSubscriptionPlan(org.orgId, { name: `Plano Vivo ${ts}` })
    await seedSubscriptionPlan(org.orgId, {
      name: `Plano Morto ${ts}`,
      archivedAt: new Date().toISOString(),
    })

    await authedPage.goto('/subscriptions/new')
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

  test('cenário 3: categoria arquivada → item mostra "Sem categoria" (sem id, sem "arquivada")', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const archivedCatId = await seedCategory(org.orgId, {
      name: `Cabelo ${ts}`,
      archivedAt: new Date().toISOString(),
    })
    await seedCatalogItem(org.orgId, {
      kind: 'service',
      name: `Corte Cat ${ts}`,
      categoryId: archivedCatId,
      commission: null,
      unitIds: org.unitIds,
    })

    await authedPage.goto('/catalog')
    const row = listItem(authedPage, new RegExp(`Corte Cat ${ts}`))
    await expect(row).toBeVisible()
    await expect(row.getByText('Sem categoria')).toBeVisible()
    await expect(authedPage.getByText('(arquivada)', { exact: false })).toHaveCount(0)
    await expect(authedPage.getByText(archivedCatId, { exact: false })).toHaveCount(0)
  })

  test('cenário 3b: categoria deletada (FK SET NULL) → item sem categoria, nunca id cru', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const orphanCatId = await seedCategory(org.orgId, { name: `Removida ${ts}` })
    await seedCatalogItem(org.orgId, {
      kind: 'service',
      name: `Corte Órfão ${ts}`,
      categoryId: orphanCatId,
      commission: null,
      unitIds: org.unitIds,
    })
    await deleteCategory(org.orgId, orphanCatId)

    await authedPage.goto('/catalog')
    const row = listItem(authedPage, new RegExp(`Corte Órfão ${ts}`))
    await expect(row).toBeVisible()
    await expect(row.getByText('30 min')).toBeVisible()
    await expect(row.getByText('Sem categoria')).toHaveCount(0)
    await expect(authedPage.getByText(orphanCatId, { exact: false })).toHaveCount(0)
  })

  test('cenário 3c: excluir categoria com itens → avisa a contagem; itens viram "Sem categoria"', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const catId = await seedCategory(org.orgId, { name: `Cabelo ${ts}` })
    for (const n of [1, 2]) {
      await seedCatalogItem(org.orgId, {
        kind: 'service',
        name: `Item Cat${n} ${ts}`,
        categoryId: catId,
        commission: null,
        unitIds: org.unitIds,
      })
    }

    await authedPage.goto('/catalog')
    const catRow = authedPage.getByRole('listitem').filter({ hasText: `Cabelo ${ts}` })
    await catRow.getByRole('button', { name: 'Excluir' }).click()

    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Deixar 2 itens sem categoria')).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    const itemRow = listItem(authedPage, new RegExp(`Item Cat1 ${ts}`))
    await expect(itemRow.getByText('Sem categoria')).toBeVisible({ timeout: 5000 })
  })

  test.describe('unidade arquivada', () => {
    test.use({ orgInput: { unitCount: 2 } })

    test('cenário 4: unidade arquivada some do seletor e não é selecionável', async ({
      org,
      authedPage,
    }) => {
      const ts = Date.now().toString()
      await seedUnit(org.orgId, {
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

  test('cenário 5: cliente com assinatura → dialog lista o cancelamento, digita p/ confirmar, cascade + nome preservado', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const name = `Cliente Cascade ${ts}`
    const customerId = await seedCustomer(org.orgId, { name })
    const planId = await seedSubscriptionPlan(org.orgId, { name: `Plano Cli ${ts}` })
    await seedSubscription(org.orgId, customerId, {
      planId,
      planName: `Plano Cli ${ts}`,
      status: 'active',
    })

    await authedPage.goto('/customers')
    const row = listItem(authedPage, new RegExp(name))
    await expect(row).toBeVisible()

    await rowActionsTrigger(row).click()
    const trigger = authedPage.getByRole('menuitem', { name: 'Excluir' })
    await expect(trigger).toBeEnabled()
    await trigger.click()

    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText(new RegExp(`Cancelar a assinatura Plano Cli ${ts}`)),
    ).toBeVisible()

    const confirm = dialog.getByRole('button', { name: 'Excluir' })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox').fill(name)
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(listItem(authedPage, new RegExp(name))).toBeHidden({
      timeout: 5000,
    })

    await authedPage.goto(`/customers/${customerId}`)
    await expect(authedPage.getByRole('heading', { name })).toBeVisible()

    await authedPage.goto('/subscriptions?status=all')
    await expect(authedPage.getByText(new RegExp(name))).toBeVisible()
    await expect(authedPage.getByText('Cancelada', { exact: true })).toBeVisible()
  })

  test('cenário 5b: cliente com comanda aberta → dialog bloqueia até fechar', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const name = `Cliente Comanda ${ts}`
    const customerId = await seedCustomer(org.orgId, { name })
    await seedOpenOrder({
      orgId: org.orgId,
      unitId: org.unitIds[0]!,
      customerId,
      attributedUserId: org.uid,
    })

    await authedPage.goto('/customers')
    await rowAction(authedPage, new RegExp(name), 'Excluir')

    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/comanda.*aberta/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Excluir' })).toBeDisabled()
  })

  test('cenário 6: cliente sem pegada → "Excluir" (digita nome) remove de vez', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const name = `Cliente Livre ${ts}`
    await seedCustomer(org.orgId, { name })

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
