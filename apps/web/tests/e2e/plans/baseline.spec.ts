// Baseline E2E (princípio #17 / lyra _shared/min-test-coverage.md).
// CRUD de plano de assinatura: render+empty · criar pelo fluxo real→listar→
// editar→excluir · dado degenerado (plano legado sem id/usageLimit).

import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { seedCustomer, seedSubscription, seedSubscriptionPlan } from '../helpers/session'

test.describe('Plans — baseline (#17)', { tag: '@critical' }, () => {
  test('render + empty state', async ({ authedPage }) => {
    // No plans → protagonist empty-state (brief 0034 / #1073): the EmptyState
    // takes over with its single CTA; the header is hidden.
    await authedPage.goto('/plans')
    await expect(authedPage.getByText('Nenhum plano cadastrado')).toBeVisible()
    await expect(authedPage.getByRole('link', { name: 'Cadastrar plano' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Planos de assinatura' })).toBeHidden()
  })

  test('criar pelo fluxo real → listar → editar → excluir', async ({ authedPage }) => {
    const ts = Date.now().toString()
    const name = `Plano Baseline ${ts}`
    const edited = `${name} Editado`

    await authedPage.goto('/plans/new')
    await authedPage.locator('input[name="name"]').fill(name)
    await authedPage.locator('input[name="priceCents"]').fill('99,90')
    // limitKind=count (default) → quantidade por ciclo é required.
    await authedPage.locator('input[name="limitQuantity"]').fill('4')
    await authedPage.locator('form').getByRole('button', { name: 'Criar' }).click()
    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Editar')
    await expect(authedPage).toHaveURL(/\/plans\/.+/)
    await authedPage.locator('input[name="name"]').fill(edited)
    await authedPage.locator('form').getByRole('button', { name: 'Salvar' }).click()
    await expect(authedPage).toHaveURL(/\/plans$/)
    await expect(authedPage.getByText(edited, { exact: true })).toBeVisible({ timeout: 5000 })

    await rowAction(authedPage, new RegExp(ts), 'Excluir')
    // Shared AlertDialog (brief 0033, AC-05) — confirm inside the dialog, not a
    // native confirm().
    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, new RegExp(ts))).toBeHidden({
      timeout: 5000,
    })
  })

  test('dado degenerado (plano legado sem id/usageLimit) renderiza e exclui', async ({
    tenant,
    authedPage,
  }) => {
    seedSubscriptionPlan(tenant.tenantId, { name: 'Plano Legado', priceCents: 0 })

    await authedPage.goto('/plans')
    await expect(authedPage.getByRole('heading', { name: 'Planos de assinatura' })).toBeVisible()
    await expect(authedPage.getByText('Plano Legado')).toBeVisible()

    await rowAction(authedPage, /Plano Legado/, 'Excluir')
    await authedPage.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /Plano Legado/)).toBeHidden({
      timeout: 5000,
    })
  })

  // One verb "Excluir" (brief 0033, AC-03 — #1070). The UI shows only "Excluir"
  // (no separate "Arquivar"). For a plan an active subscription references, the
  // single "Excluir" soft-deletes (archives) under the hood: it drops from the
  // active list while the subscriber keeps the frozen snapshot. The dialog warns
  // up front ("os assinantes atuais continuam").
  test('em uso: 1 verbo "Excluir" vira soft-delete (some da ativa, vínculo segue)', async ({
    tenant,
    authedPage,
  }) => {
    const planId = seedSubscriptionPlan(tenant.tenantId, { name: 'Plano Em Uso' })
    const customerId = seedCustomer(tenant.tenantId, { name: 'Cliente Assinante' })
    // The subscription freezes `plan.planId == planId` — exactly what the guard
    // queries.
    seedSubscription(tenant.tenantId, customerId, { planId })

    await authedPage.goto('/plans')
    await expect(listItem(authedPage, /Plano Em Uso/)).toBeVisible()
    // No "Arquivar" verb anywhere (AC-03).
    await expect(authedPage.getByRole('button', { name: 'Arquivar' })).toHaveCount(0)
    await expect(authedPage.getByRole('menuitem', { name: 'Arquivar' })).toHaveCount(0)

    await rowAction(authedPage, /Plano Em Uso/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // Context-aware copy for the soft-delete branch (AC-05 + bug 1 cycle-end
    // wording): active subs finish their current cycle, new adesões blocked.
    await expect(dialog.getByText(/fim do ciclo vigente/i)).toBeVisible()
    await dialog.getByRole('button', { name: 'Excluir' }).click()

    // Soft-deleted: drops from the active list (the subscription keeps its frozen
    // snapshot — not asserted here, covered by the guard unit/integration tests).
    await expect(listItem(authedPage, /Plano Em Uso/)).toBeHidden({
      timeout: 5000,
    })
  })

  // Counterpart: a free plan (no active subscription) hard-deletes cleanly via
  // the same single "Excluir" verb.
  test('livre: "Excluir" hard-delete remove de vez (sem assinaturas)', async ({
    tenant,
    authedPage,
  }) => {
    seedSubscriptionPlan(tenant.tenantId, { name: 'Plano Livre' })

    await authedPage.goto('/plans')
    await expect(listItem(authedPage, /Plano Livre/)).toBeVisible()

    await rowAction(authedPage, /Plano Livre/, 'Excluir')
    await authedPage.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /Plano Livre/)).toBeHidden({ timeout: 5000 })
  })
})
