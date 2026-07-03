// Baseline E2E — contrato de cobertura mínima (princípio #17 / lyra
// _shared/min-test-coverage.md). TEMPLATE de referência pro resto das features.
//
// Cobre o feijão-com-arroz que os bugs previsíveis exploram:
// - render + empty state
// - criar pelo fluxo REAL da UI → listar
// - editar → reflete
// - excluir → some e a lista volta a renderizar
// - dado degenerado (cliente avulso: userId vazio / sem tags / sem campo id)
//
// Origem: bug /customers 500 em 2026-05-28 (3 bugs triviais que o seed
// "perfeito" do journey escondia). Roda contra build de produção + emulator.

import { expect, test } from '../fixtures'
import { listItem, rowAction } from '../helpers/list'
import { seedCustomer, seedCustomerShadowForUser, uniqueWhatsapp } from '../helpers/session'

// Semeia um cliente "degenerado": um Customer shadow schema-completo cujo
// `userId` aponta pra um User que NÃO existe (avulso sem user resolvível) —
// reproduz a forma que quebrava render + delete antes do fix em customer-read.ts
// (a identidade não materializa → "(usuário não encontrado)").
async function seedDegenerateCustomer(orgId: string): Promise<string> {
  const missingUserId = `e2e-missing-user-${Math.random().toString(36).slice(2)}`
  return await seedCustomerShadowForUser(orgId, missingUserId)
}

test.describe('Customers — baseline (#17)', () => {
  test('render + empty state', async ({ authedPage }) => {
    // No customers → protagonist empty-state (brief 0034 / #1073). Since brief
    // 0077 (#1279) the establishment no longer types customer PII — the CTA
    // opens a contextual-invite dialog ("Convidar cliente").
    await authedPage.goto('/customers')
    await expect(authedPage.getByText('Nenhum cliente cadastrado')).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Convidar cliente' })).toBeVisible()
    await expect(authedPage.getByRole('heading', { name: 'Clientes' })).toBeHidden()
  })

  test('convidar pelo fluxo real gera link contextual (sem digitar PII do cliente)', async ({
    authedPage,
  }) => {
    // The invite surface is a dialog on the list (#1279, mirrors Equipe): the recep
    // types ONLY a WhatsApp number and gets a signup link back — no Customer with
    // recep-typed PII is created (that kills the wrong-number ghost).
    await authedPage.goto('/customers')
    await authedPage.getByRole('button', { name: 'Convidar cliente' }).click()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Convidar cliente' })).toBeVisible()
    await dialog.locator('input[name="whatsapp"]').fill(`119${Date.now().toString().slice(-8)}`)
    // A copyable contextual link carrying `from={slug}` is built live as the
    // number becomes valid (no submit) + a "Abrir no WhatsApp" primary action.
    await expect(dialog.getByRole('textbox', { name: 'Link do convite' })).toHaveValue(/\/signup\?/)
    await expect(dialog.getByRole('button', { name: /abrir no whatsapp/i })).toBeVisible()
  })

  test('listar → ver → excluir (cliente materializado)', async ({ org, authedPage }) => {
    // Customers now materialize via self-signup, not a balcão form. Seed one to
    // cover the list/view/delete contract the page still owns. The establishment
    // only CONSULTS the customer (read-only detail) — editing belongs to the
    // customer (#1278). Unique per run (User is deduped by whatsapp globally).
    await seedCustomer(org.orgId, {
      name: 'Cliente Baseline',
      mobile: uniqueWhatsapp(),
    })

    await authedPage.goto('/customers')
    await expect(authedPage.getByText('Cliente Baseline')).toBeVisible({ timeout: 5000 })

    // Ver — read-only detail (no edit form, no Salvar).
    await rowAction(authedPage, /Cliente Baseline/, 'Ver')
    await expect(authedPage).toHaveURL(/\/customers\/.+/)
    await expect(authedPage.getByRole('heading', { name: 'Cliente Baseline' })).toBeVisible()
    await expect(authedPage.getByRole('button', { name: 'Salvar' })).toBeHidden()
    await authedPage.goto('/customers')

    // Excluir — shared AlertDialog (brief 0033, AC-05/AC-10): high-impact, so
    // type the name to confirm before the destructive button enables.
    await rowAction(authedPage, /Cliente Baseline/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await dialog.getByRole('textbox').fill('Cliente Baseline')
    await dialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /Cliente Baseline/)).toBeHidden({
      timeout: 5000,
    })
  })

  test('dado degenerado (cliente avulso sem user/tags/id) renderiza e exclui', async ({
    org,
    authedPage,
  }) => {
    await seedDegenerateCustomer(org.orgId)

    // Lista renderiza sem 500 (graceful "(usuário não encontrado)").
    await authedPage.goto('/customers')
    await expect(authedPage.getByRole('heading', { name: 'Clientes' })).toBeVisible()
    await expect(authedPage.getByText('(usuário não encontrado)')).toBeVisible()

    // Excluir funciona (id vem do doc real, não do campo vazio). Type-to-confirm
    // uses the resolved display name "(usuário não encontrado)".
    await rowAction(authedPage, /usuário não encontrado/, 'Excluir')
    const dialog = authedPage.getByRole('alertdialog')
    await dialog.getByRole('textbox').fill('(usuário não encontrado)')
    await dialog.getByRole('button', { name: 'Excluir' }).click()
    await expect(listItem(authedPage, /usuário não encontrado/)).toBeHidden({
      timeout: 5000,
    })
  })
})
