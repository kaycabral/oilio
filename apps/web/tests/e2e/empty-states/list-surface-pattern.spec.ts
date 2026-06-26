// E2E for #1072 (brief 0034) — the shared list-surface pattern, exercised on
// the reference surface `/subscriptions` (it carries filter tabs, so it covers
// all three states):
//
// AC-01 [critical] [smoke] — no data → EmptyState protagonist (1 CTA); header
//   CTA + filter tabs hidden.
// AC-02 [critical] [smoke] — filtered-empty → filters stay + "nenhum resultado".
// AC-03 [critical]          — the shared helper decides the state (proven by the
//   same surface flipping chrome across the three states).
// AC-04 [critical]          — no premature interactive surface on empty (only the
//   single CTA; no filter tabs to click).

import { expect, test } from '../fixtures'
import { chooseOptionByIndex } from '../helpers/select'
import { seedCustomer, seedSubscriptionPlan } from '../helpers/session'

test.describe('List-surface pattern — three states (#1072)', () => {
  test('no data → EmptyState protagonist, header CTA + filter tabs hidden', async ({
    authedPage,
  }) => {
    // Fresh org: zero subscriptions ⇒ protagonist state.
    await authedPage.goto('/subscriptions')

    // AC-01: protagonist empty-state with a single create CTA.
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeVisible()
    await expect(authedPage.getByRole('link', { name: 'Nova assinatura' })).toBeVisible()

    // AC-01/AC-04: the page heading, the header CTA duplicate and the status
    // filter (a Select combobox) are all hidden — only the protagonist shows.
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeHidden()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toBeHidden()
  })

  test('with data → normal chrome; filtered-empty → filters stay + no-results', async ({
    org,
    authedPage,
  }) => {
    const ts = Date.now().toString()
    const planLabel = `Plano LS ${ts}`
    await seedSubscriptionPlan(org.orgId, { name: planLabel })
    await seedCustomer(org.orgId)

    // Create one subscription through the real flow (lands as `pending` → open).
    await authedPage.goto('/subscriptions/new')
    // Only one seeded customer (no materialized name) → pick the first option.
    await chooseOptionByIndex(authedPage, 'Cliente', 0)
    await authedPage.getByRole('button', { name: 'Criar assinatura' }).click()
    await expect(authedPage).toHaveURL(/\/subscriptions\/.+/)
    await expect(authedPage.getByText('Aguardando 1ª cobrança')).toBeVisible({ timeout: 5000 })

    // AC-03 populated: data exists in the current view → full chrome + the row.
    // The status filter is a combobox; with `status=open` applied it reads "Em aberto".
    await authedPage.goto('/subscriptions?status=open')
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeVisible()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toHaveText('Em aberto')
    await expect(authedPage.getByText(planLabel)).toBeVisible({ timeout: 5000 })

    // AC-02 filtered-empty: data exists, but the "Encerradas" slice is empty →
    // filters stay, a "no results" message replaces the list, and the create
    // protagonist does NOT take over (there IS data, just not in this slice).
    await authedPage.goto('/subscriptions?status=cancelled')
    await expect(authedPage.getByRole('heading', { name: 'Assinaturas' })).toBeVisible()
    await expect(authedPage.getByRole('combobox', { name: 'Status' })).toHaveText('Encerradas')
    await expect(authedPage.getByText(/nenhuma assinatura para/i)).toBeVisible()
    await expect(authedPage.getByText('Nenhuma assinatura cadastrada')).toBeHidden()
  })
})
